import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { POST } from '@/app/api/platform-settings/route';

const mockRequireRole = vi.mocked(requireRole);
const mockAdminClient = vi.mocked(adminClient);

/** Captures the row the route tries to write. */
function stubDb() {
  const written: any[] = [];
  const db = {
    from: () => ({
      upsert: async (row: any) => { written.push(row); return { error: null }; },
    }),
  };
  return { db, written };
}

const request = (body: unknown) => new Request('http://localhost/api/platform-settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ user: { id: 'admin-1' } } as any);
});

describe('POST /api/platform-settings -- analytics', () => {
  it('stores a measurement ID uppercase', async () => {
    const { db, written } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ googleAnalyticsId: 'g-abc1234567' }));

    expect(res.status).toBe(200);
    expect(written[0].google_analytics_id).toBe('G-ABC1234567');
  });

  it('refuses a malformed ID instead of saving one that collects nothing', async () => {
    // Nulling it the way the URL fields are nulled would report success, and the admin would go
    // looking for visitor numbers that were never being recorded.
    const { db, written } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ googleAnalyticsId: 'UA-12345-1' }));

    expect(res.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('clears the column when the field is emptied, which is how analytics are switched off', async () => {
    const { db, written } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ googleAnalyticsId: '   ' }));

    expect(res.status).toBe(200);
    expect(written[0].google_analytics_id).toBeNull();
  });

  it('leaves the column alone when the body does not mention it', async () => {
    // Each settings tab posts only its own fields, so saving the Identity tab must not switch
    // analytics off.
    const { db, written } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    await POST(request({ appName: 'Somewhere' }));

    expect(written[0]).not.toHaveProperty('google_analytics_id');
  });

  it('is writable by instructors as well as admins, deliberately', async () => {
    // Scoped this way on purpose: this platform treats the two roles as one. It does mean any
    // instructor can point tracking at a property they control, which is why the tag redacts
    // auth tokens before reporting a URL (see lib/analytics).
    const { db } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    await POST(request({ googleAnalyticsId: 'G-ABC1234567' }));

    expect(mockRequireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'instructor']);
  });

  it('turns an unauthorised caller away before touching the row', async () => {
    mockRequireRole.mockResolvedValue({ error: new Response('no', { status: 403 }) } as any);
    const { db, written } = stubDb();
    mockAdminClient.mockReturnValue(db as any);

    const res = await POST(request({ googleAnalyticsId: 'G-ABC1234567' }));

    expect(res.status).toBe(403);
    expect(written).toHaveLength(0);
  });
});
