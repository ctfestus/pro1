import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: vi.fn(),
}));

vi.mock('@/lib/ai-limits-server', () => ({
  clearAiLimitsCache: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { GET, POST } from '@/app/api/ai-limits/route';
import { AI_LIMIT_DEFAULTS } from '@/lib/ai-limits';

const mockRequireRole = vi.mocked(requireRole);
const mockAdminClient = vi.mocked(adminClient);

/** Captures what the route tries to write, and answers reads with whatever is already stored. */
function stubDb(stored: Record<string, any> | null, readError: any = null) {
  const written: any[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: stored === null ? null : { ai_limits: stored }, error: readError }) }),
      }),
      upsert: async (row: any) => { written.push(row); return { error: null }; },
    }),
  };
  return { db, written };
}

const request = (body?: unknown) => new Request('http://localhost/api/ai-limits', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ user: { id: 'admin-1' } } as any);
});

describe('GET /api/ai-limits', () => {
  it('reports a read failure instead of answering with defaults', async () => {
    // Defaults would look like a platform nobody has configured, and an admin who then pressed
    // Save would overwrite the real settings with them.
    const { db } = stubDb(null, { message: 'connection lost' });
    mockAdminClient.mockReturnValue(db as any);

    const res = await GET(request());

    expect(res.status).toBe(500);
  });
});

describe('POST /api/ai-limits', () => {
  it('keeps features the caller did not send', async () => {
    // The column is written whole, so a body naming one feature must not quietly reset the rest.
    const { db, written } = stubDb({ excelReview: { free: 2, paid: 9 } });
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ codeReview: { free: 1, paid: 5 } }));

    expect(res.status).toBe(200);
    expect(written[0].ai_limits).toEqual({
      excelReview: { free: 2, paid: 9 },
      codeReview: { free: 1, paid: 5 },
    });
  });

  it('stores a zero, which is how a plan closes a feature', () => {
    const { db, written } = stubDb(null);
    mockAdminClient.mockReturnValue(db as any);

    return POST(request({ practiceChecks: { free: 0, paid: 20 } })).then((res: any) => {
      expect(res.status).toBe(200);
      expect(written[0].ai_limits.practiceChecks).toEqual({ free: 0, paid: 20 });
    });
  });

  it('refuses the whole save when any value is out of range', async () => {
    const { db, written } = stubDb({ codeReview: { free: 0, paid: 3 } });
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ codeReview: { free: 0, paid: 99_999 } }));

    expect(res.status).toBe(400);
    // Nothing written: a half-save would report success while leaving a mix of what the admin
    // typed and what was there before.
    expect(written).toHaveLength(0);
    expect((await res.json()).error).toContain('Code review');
  });

  it('ignores features no route reads', async () => {
    const { db, written } = stubDb(null);
    mockAdminClient.mockReturnValue(db as any);

    await POST(request({ codeReview: { free: 1, paid: 5 }, somethingElse: { free: 9, paid: 9 } }));

    expect(written[0].ai_limits).toEqual({ codeReview: { free: 1, paid: 5 } });
  });

  it('answers with the limits in force, defaults filled in', async () => {
    const { db } = stubDb(null);
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ codeReview: { free: 1, paid: 5 } }));
    const json = await res.json();

    expect(json.limits.codeReview).toEqual({ free: 1, paid: 5 });
    expect(json.limits.excelReview).toEqual(AI_LIMIT_DEFAULTS.excelReview);
  });
});
