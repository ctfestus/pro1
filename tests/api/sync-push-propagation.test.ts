// sync-push turns the destination platform's answer into this platform's answer. The
// distinction that matters to an operator is WHY a push stopped: a coded rejection is the
// destination refusing this content (e.g. a guide whose consent is still pending) and must
// keep its own status, while anything else is a transport fault and stays a 502. Flattening
// the first into the second sends operators hunting for an unreachable server.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { POST } from '@/app/api/sync-push/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);
const fetchMock = vi.fn();

function push() {
  return POST(new Request('http://localhost/api/sync-push', {
    method: 'POST',
    body: JSON.stringify({ type: 'course', id: 'course1' }),
  }) as any);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  process.env.PLATFORM_SYNC_URL = 'https://destination.example';
  process.env.PLATFORM_SYNC_KEY = 'test-sync-key';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockRequireRole.mockReset();
  mockRequireRole.mockResolvedValue({
    user: { id: 'instructor1' },
    role: 'instructor',
    token: 'test-token',
    supabase: makeSupabaseStub({
      courses: { data: { id: 'course1', title: 'Intro to SQL' }, error: null },
    }),
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/sync-push destination-error propagation', () => {
  it('keeps a coded rejection at its own status and logs it as a destination decision', async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { error: 'Permission must be confirmed before publishing a professional profile.', code: 'guide_consent_required' },
      400,
    ));

    const response = await push();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'guide_consent_required' });
    expect(console.error).toHaveBeenCalledWith(
      '[sync-push] destination rejected:',
      'guide_consent_required',
      'Permission must be confirmed before publishing a professional profile.',
    );
  });

  it('keeps an uncoded destination error as a 502', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Failed to sync course.' }, 500));

    const response = await push();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to sync course.' });
  });

  it('keeps a non-JSON destination response as a 502', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }));

    const response = await push();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('PLATFORM_SYNC_URL') });
  });

  it('keeps an unreachable destination as a 502', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await push();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Could not reach destination') });
  });

  // The rejection branch keys off `code`, so it must also require `error` -- otherwise a
  // success payload that ever carries a `code` field would be reported as a failed push.
  it('passes a successful destination response through untouched', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'remote1', slug: 'intro-to-sql', action: 'updated', code: 'ok' }, 200));

    const response = await push();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 'remote1', slug: 'intro-to-sql', action: 'updated', code: 'ok' });
    expect(console.error).not.toHaveBeenCalled();
  });
});
