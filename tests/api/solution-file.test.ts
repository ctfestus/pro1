import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// The solution-file route is the ONLY way into the private 'assignment-solutions' bucket, so it
// owns the release rule: a grader may always fetch the model answer, a student only once their own
// submission -- or their group's -- is graded AND passing. These tests pin that gate (and prove the
// grader path does not even look at submissions: the stub throws on an unconfigured table).

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { GET } from '@/app/api/assignments/solution-file/route';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockAdminClient = vi.mocked(adminClient);

const FILE_ROW = { id: 'sol1', assignment_id: 'a1', name: 'model-answer.xlsx', kind: 'file', storage_path: 'u1/1_model.xlsx' };

function db(byTable: Record<string, QueryResult | QueryResult[]>, signedUrl: string | null = 'https://signed.example/x') {
  const stub: any = makeSupabaseStub(byTable);
  stub.storage = {
    from: () => ({
      createSignedUrl: async () => signedUrl
        ? { data: { signedUrl }, error: null }
        : { data: null, error: { message: 'nope' } },
    }),
  };
  return stub;
}

function get(id: string | null = 'sol1') {
  const url = id == null ? 'http://localhost/api/assignments/solution-file' : `http://localhost/api/assignments/solution-file?id=${id}`;
  return GET(new Request(url) as any);
}
function authed(userId: string) {
  mockRequireUser.mockResolvedValue({ user: { id: userId }, serviceDb: {}, token: 't' } as any);
}

beforeEach(() => { mockRequireUser.mockReset(); mockAdminClient.mockReset(); });

describe('GET /api/assignments/solution-file', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    mockAdminClient.mockReturnValue(db({}));
    expect((await get()).status).toBe(401);
  });

  it('400 without an id', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({}));
    expect((await get(null)).status).toBe(400);
  });

  it('404 when the solution row does not exist', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({ assignment_solutions: { data: null, error: null } }));
    expect((await get()).status).toBe(404);
  });

  it('400 for a link row (there is nothing to sign)', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: { ...FILE_ROW, kind: 'link', storage_path: null, url: 'https://x' }, error: null },
    }));
    expect((await get()).status).toBe(400);
  });

  it('403 for a student whose submission has not passed', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: FILE_ROW, error: null },
      students: { data: { role: 'student' }, error: null },
      assignments: { data: { config: null }, error: null },
      group_members: { data: [], error: null },
      assignment_submissions: { data: [], error: null },
    }));
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/pass/i);
  });

  it('200 with a signed URL once the student own submission has passed', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: FILE_ROW, error: null },
      students: { data: { role: 'student' }, error: null },
      assignments: { data: { config: null }, error: null },
      group_members: { data: [], error: null },
      assignment_submissions: { data: [{ id: 'sub1' }], error: null },
    }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://signed.example/x');
    expect(body.name).toBe('model-answer.xlsx');
  });

  it('200 for a group member once the GROUP submission has passed', async () => {
    authed('s1');
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: FILE_ROW, error: null },
      students: { data: { role: 'student' }, error: null },
      assignments: { data: { config: null }, error: null },
      group_members: { data: [{ group_id: 'g1' }], error: null },
      // own lookup first (none), then the group lookup (graded)
      assignment_submissions: [{ data: [], error: null }, { data: [{ id: 'sub9' }], error: null }],
    }));
    expect((await get()).status).toBe(200);
  });

  it('200 for a grader without consulting submissions at all', async () => {
    authed('i1');
    // assignment_submissions / group_members are deliberately NOT configured: the stub throws if
    // the route queries them, which is what makes the grader shortcut observable.
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: FILE_ROW, error: null },
      students: { data: { role: 'instructor' }, error: null },
    }));
    expect((await get()).status).toBe(200);
  });

  it('502 when the signed URL cannot be created', async () => {
    authed('i1');
    mockAdminClient.mockReturnValue(db({
      assignment_solutions: { data: FILE_ROW, error: null },
      students: { data: { role: 'admin' }, error: null },
    }, null));
    expect((await get()).status).toBe(502);
  });
});
