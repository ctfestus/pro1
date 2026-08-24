import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Clearing the mandatory setup claim must require an actual password change. If the
// endpoint only cleared the claim, anyone holding the recovery session could call it
// directly and walk past the middleware gate without choosing a password.

const h = vi.hoisted(() => {
  // Widened so a case can stub an error without fighting the inferred `null` type.
  type Result = Promise<{ error: { message: string } | null }>;
  const updateUserById = vi.fn(async (): Result => ({ error: null }));
  const eq             = vi.fn(async (): Result => ({ error: null }));
  const update         = vi.fn(() => ({ eq }));
  const from           = vi.fn(() => ({ update }));
  const requireUser    = vi.fn();
  const markPasswordSetupComplete = vi.fn(async () => undefined);
  return { updateUserById, eq, update, from, requireUser, markPasswordSetupComplete };
});

vi.mock('@/lib/account-state-server', () => ({
  markPasswordSetupComplete: h.markPasswordSetupComplete,
}));

vi.mock('@/lib/api-auth', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    requireUser: h.requireUser,
    isAuthError: (r: unknown) => (r as { error?: unknown })?.error instanceof NR,
  };
});

import { POST } from '@/app/api/account/complete-setup/route';

const AUTHED = {
  user: { id: 'student-1', email: 's@example.com' },
  serviceDb: {
    auth: { admin: { updateUserById: h.updateUserById } },
    from: h.from,
  },
};

function post(body: unknown) {
  return new NextRequest('http://localhost/api/account/complete-setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/account/complete-setup', () => {
  beforeEach(() => {
    // mockReset drops implementations too, so each case starts from the happy path
    // instead of inheriting the previous test's error stub. from/update keep their
    // implementations (they build the query chain) and only lose call history.
    h.updateUserById.mockReset();
    h.updateUserById.mockResolvedValue({ error: null });
    h.eq.mockReset();
    h.eq.mockResolvedValue({ error: null });
    h.from.mockClear();
    h.update.mockClear();
    h.markPasswordSetupComplete.mockReset();
    h.markPasswordSetupComplete.mockResolvedValue(undefined);
    h.requireUser.mockReset();
    h.requireUser.mockResolvedValue(AUTHED);
  });

  it('rejects an unauthenticated call', async () => {
    h.requireUser.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(post({ password: 'a-good-password' }));

    expect(response.status).toBe(401);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  // The bypass this endpoint exists to prevent.
  it('refuses to clear the claim when no password is supplied', async () => {
    const response = await POST(post({}));

    expect(response.status).toBe(400);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('refuses a password below the minimum length', async () => {
    const response = await POST(post({ password: 'short' }));

    expect(response.status).toBe(400);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const response = await POST(post('not json'));

    expect(response.status).toBe(400);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('sets the password, then clears the claim through the shared writer', async () => {
    const response = await POST(post({ password: 'a-good-password' }));

    expect(response.status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledWith('student-1', { password: 'a-good-password' });
    expect(h.markPasswordSetupComplete).toHaveBeenCalledWith(expect.anything(), 'student-1');
  });

  // Ordering matters: the gate must not open unless the password actually landed.
  it('leaves the claim in place when the password change fails', async () => {
    h.updateUserById.mockResolvedValue({ error: { message: 'Password is too weak' } });

    const response = await POST(post({ password: 'a-good-password' }));

    expect(response.status).toBe(400);
    expect(h.markPasswordSetupComplete).not.toHaveBeenCalled();
  });

  // The writer updates the row and the cached claim together, so a partial failure has
  // to surface rather than leave the student believing setup is done.
  it('reports a failure to clear the claim', async () => {
    h.markPasswordSetupComplete.mockRejectedValue(new Error('claim update failed'));

    const response = await POST(post({ password: 'a-good-password' }));

    expect(response.status).toBe(500);
  });
});
