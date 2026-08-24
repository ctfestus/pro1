import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { GET, POST } from '@/app/api/partners/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);
const mockAdminClient = vi.mocked(adminClient);

function request(method = 'GET', body?: unknown) {
  return new Request('http://localhost/api/partners', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockAdminClient.mockReset();
});

describe('/api/partners', () => {
  it('returns 401 for an unauthenticated write', async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await POST(request('POST', { name: 'Google' }))).status).toBe(401);
  });

  it('returns 403 for a student write', async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(request('POST', { name: 'Google' }))).status).toBe(403);
  });

  it('allows an admin to create a partner', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'admin-1' },
      actor: { id: 'admin-1' },
      isStudentMode: false,
      role: 'admin',
      token: 'test-token',
      getActorDb: () => ({} as any),
      serviceDb: {} as any,
    });
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      partners: {
        data: {
          id: 'partner-1',
          name: 'Google',
          logo_url: null,
          website_url: null,
          description: null,
          is_active: true,
          created_at: '2026-07-18T00:00:00.000Z',
        },
        error: null,
      },
    }) as any);

    const res = await POST(request('POST', { name: '  Google  ' }));
    expect(res.status).toBe(200);
    expect((await res.json()).partner.name).toBe('Google');
  });

  it('returns active partners to an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      partners: {
        data: [{ id: 'partner-1', name: 'Google', is_active: true }],
        error: null,
      },
    }) as any);

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).partners).toEqual([
      { id: 'partner-1', name: 'Google', is_active: true },
    ]);
  });
});
