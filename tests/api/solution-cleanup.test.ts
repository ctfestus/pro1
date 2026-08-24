import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Cleanup must never delete a solution file that is still in use. Duplicating an assignment copies
// the row and shares the object, so "the caller says this path is free" is not good enough: the
// route re-counts references itself. These tests pin that, the uploader scoping for non-admins, and
// the age guard that protects a file uploaded but not yet saved.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { requireRole } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { POST } from '@/app/api/assignments/solution-cleanup/route';

const mockRequireRole = vi.mocked(requireRole);
const mockAdminClient = vi.mocked(adminClient);

const HOUR = 60 * 60 * 1000;
const oldStamp = new Date(Date.now() - 72 * HOUR).toISOString();
const freshStamp = new Date(Date.now() - 1 * HOUR).toISOString();

// A stub that records what was removed. `referenced` is the set of paths an assignment still uses;
// `objects` is the bucket laid out as { '<folder>': [{ name, created_at }] }.
function stub({ referenced = [] as string[], objects = {} as Record<string, { name: string; created_at: string }[]> } = {}) {
  const removed: string[][] = [];
  const store = {
    list: async (prefix: string) => prefix === ''
      ? { data: Object.keys(objects).map(name => ({ name, id: null })), error: null }
      : { data: (objects[prefix] ?? []).map(f => ({ ...f, id: `id-${f.name}` })), error: null },
    remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
  };
  const client = {
    from: (table: string) => {
      if (table !== 'assignment_solutions') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: async (_col: string, paths: string[]) => ({
            data: paths.filter(p => referenced.includes(p)).map(p => ({ storage_path: p })),
            error: null,
          }),
        }),
      };
    },
    storage: { from: () => store },
  };
  return { client, removed };
}

function post(body: any) {
  return POST(new Request('http://localhost/api/assignments/solution-cleanup', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }) as any);
}
function authed(userId: string, role: string) {
  mockRequireRole.mockResolvedValue({ user: { id: userId }, role, serviceDb: {}, token: 't' } as any);
}

beforeEach(() => { mockRequireRole.mockReset(); mockAdminClient.mockReset(); });

describe('POST /api/assignments/solution-cleanup', () => {
  it('403 for a caller who is not an instructor or admin', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    mockAdminClient.mockReturnValue(stub().client as any);
    expect((await post({ paths: ['u1/x.xlsx'] })).status).toBe(403);
  });

  it('keeps a path another assignment still references', async () => {
    authed('u1', 'instructor');
    const s = stub({ referenced: ['u1/shared.xlsx'] });
    mockAdminClient.mockReturnValue(s.client as any);
    const res = await post({ paths: ['u1/shared.xlsx'] });
    expect((await res.json()).deleted).toBe(0);
    expect(s.removed).toEqual([]);   // nothing removed at all
  });

  it('deletes a path nothing references', async () => {
    authed('u1', 'instructor');
    const s = stub({ referenced: [] });
    mockAdminClient.mockReturnValue(s.client as any);
    const res = await post({ paths: ['u1/orphan.xlsx'] });
    expect((await res.json()).deleted).toBe(1);
    expect(s.removed).toEqual([['u1/orphan.xlsx']]);
  });

  it('ignores a non-admin naming another uploader file, but an admin may name it', async () => {
    authed('u1', 'instructor');
    const asInstructor = stub({ referenced: [] });
    mockAdminClient.mockReturnValue(asInstructor.client as any);
    expect((await (await post({ paths: ['u2/other.xlsx'] })).json()).deleted).toBe(0);
    expect(asInstructor.removed).toEqual([]);

    authed('admin1', 'admin');
    const asAdmin = stub({ referenced: [] });
    mockAdminClient.mockReturnValue(asAdmin.client as any);
    expect((await (await post({ paths: ['u2/other.xlsx'] })).json()).deleted).toBe(1);
  });

  it('sweeps long-orphaned objects but leaves fresh and referenced ones', async () => {
    authed('u1', 'instructor');
    const s = stub({
      referenced: ['u2/in-use.xlsx'],
      objects: {
        u1: [{ name: 'stale.xlsx', created_at: oldStamp }, { name: 'just-uploaded.xlsx', created_at: freshStamp }],
        u2: [{ name: 'in-use.xlsx', created_at: oldStamp }],
      },
    });
    mockAdminClient.mockReturnValue(s.client as any);
    const res = await post({});
    expect((await res.json()).deleted).toBe(1);
    expect(s.removed).toEqual([['u1/stale.xlsx']]);  // fresh upload + in-use file survive
  });

  it('deletes nothing when the reference lookup fails', async () => {
    authed('u1', 'instructor');
    const s = stub({ referenced: [] });
    s.client.from = () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }) }) as any;
    mockAdminClient.mockReturnValue(s.client as any);
    expect((await (await post({ paths: ['u1/orphan.xlsx'] })).json()).deleted).toBe(0);
    expect(s.removed).toEqual([]);
  });
});
