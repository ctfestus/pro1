// An import that carries a worksheet list the rules refuse must be turned away at the door.
//
// The helpers are unit-tested next door; what these cover is the wiring: that each endpoint calls
// them BEFORE it writes, so a refused import leaves nothing behind. Persisting it instead would
// look like a successful import and only surface much later, as an error on a student's review.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { requireRole } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { POST as importPost } from '@/app/api/content-import/route';
import { POST as syncPost } from '@/app/api/sync-receive/route';

const mockRequireRole = vi.mocked(requireRole);
const mockAdminClient = vi.mocked(adminClient);

const SYNC_KEY = 'test-sync-key';
const TOO_MANY = Array.from({ length: 21 }, (_, index) => `Sheet ${index}`);
const TOO_LONG = 'x'.repeat(32);

// Any read or write goes through from(), so an untouched spy is proof the route stopped first.
let from: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  from = vi.fn();
  mockRequireRole.mockResolvedValue({ user: { id: 'u1' }, role: 'instructor', serviceDb: { from } } as any);
  mockAdminClient.mockReturnValue({ from } as any);
  process.env.PLATFORM_SYNC_KEY = SYNC_KEY;
  process.env.PLATFORM_SYNC_OWNER_ID = 'owner-1';
});

async function contentImport(body: unknown): Promise<{ status: number; json: any }> {
  const res = await importPost(new Request('http://localhost/api/content-import', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any) as unknown as Response;
  return { status: res.status, json: await res.json() };
}

async function syncReceive(payload: unknown): Promise<{ status: number; json: any }> {
  const rawBody = JSON.stringify({ payload });
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', SYNC_KEY).update(`${timestamp}.${rawBody}`).digest('hex');
  const res = await syncPost(new Request('http://localhost/api/sync-receive', {
    method: 'POST',
    headers: { 'x-sync-timestamp': timestamp, 'x-sync-signature': signature },
    body: rawBody,
  }) as any) as unknown as Response;
  return { status: res.status, json: await res.json() };
}

describe('import and sync refuse invalid worksheet lists before writing', () => {
  it('turns away an imported course whose worksheet name is too long', async () => {
    const { status, json } = await contentImport({
      exportVersion: 1,
      type: 'course',
      config: { isCourse: true, questions: [{ id: 'q1', type: 'excel_review', reviewSheetNames: [TOO_LONG] }] },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('31 characters or fewer');
    expect(from).not.toHaveBeenCalled();
  });

  it('turns away an imported virtual experience with too many worksheets', async () => {
    const { status, json } = await contentImport({
      exportVersion: 1,
      type: 'virtual_experience',
      config: { modules: [{ lessons: [{ requirements: [{ id: 'r1', type: 'excel_review', reviewSheetNames: TOO_MANY }] }] }] },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('no more than 20');
    expect(from).not.toHaveBeenCalled();
  });

  it('turns away an imported assignment whose worksheet list is not a list', async () => {
    const { status, json } = await contentImport({
      exportVersion: 1,
      type: 'assignment',
      data: { title: 'Imported', type: 'excel_review', config: { reviewSheetNames: 'Summary' } },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('list of text values');
    expect(from).not.toHaveBeenCalled();
  });

  it('turns away a synced course with too many worksheets', async () => {
    const { status, json } = await syncReceive({
      exportVersion: 1,
      type: 'course',
      config: { isCourse: true, questions: [{ id: 'q1', type: 'excel_review', reviewSheetNames: TOO_MANY }] },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('no more than 20');
    expect(from).not.toHaveBeenCalled();
  });

  it('turns away a synced virtual experience whose worksheet name is too long', async () => {
    const { status, json } = await syncReceive({
      exportVersion: 1,
      type: 'virtual_experience',
      config: { modules: [{ lessons: [{ requirements: [{ id: 'r1', type: 'excel_review', reviewSheetNames: [TOO_LONG] }] }] }] },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('31 characters or fewer');
    expect(from).not.toHaveBeenCalled();
  });

  it('turns away a synced assignment whose worksheet list is not a list', async () => {
    const { status, json } = await syncReceive({
      exportVersion: 1,
      type: 'assignment',
      data: { title: 'Synced', type: 'excel_review', config: { reviewSheetNames: 'Summary' } },
    });

    expect(status).toBe(400);
    expect(json.error).toContain('list of text values');
    expect(from).not.toHaveBeenCalled();
  });

  it('writes the cleaned worksheet list when the rules allow it', async () => {
    // The guard is not simply refusing everything: a list it can tidy is tidied and stored.
    const inserts: Array<{ table: string; payload: any }> = [];
    from = vi.fn((table: string) => {
      const builder: any = {
        insert: (payload: any) => { inserts.push({ table, payload }); return builder; },
        update: () => builder,
        delete: () => builder,
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: 'assignment-1' }, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'u1' }, role: 'instructor', serviceDb: { from } } as any);

    const { status } = await contentImport({
      exportVersion: 1,
      type: 'assignment',
      data: { title: 'Imported', type: 'excel_review', config: { reviewSheetNames: [' Summary ', 'summary'] } },
    });

    expect(status).not.toBe(400);
    const written = inserts.find(entry => entry.table === 'assignments');
    expect(written?.payload.config.reviewSheetNames).toEqual(['Summary']);
  });
});
