import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The setup link is a single-use token. It must only be spent by a deliberate POST
// from the interstitial, never by a GET, so that mail scanners and link previewers
// cannot burn it before the student clicks Continue.

const h = vi.hoisted(() => {
  const eq        = vi.fn(async () => ({ error: null }));
  const update    = vi.fn(() => ({ eq }));
  const from      = vi.fn(() => ({ update }));
  const verifyOtp = vi.fn();
  const getUser   = vi.fn();
  return { eq, update, from, verifyOtp, getUser };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { verifyOtp: h.verifyOtp, getUser: h.getUser },
    from: h.from,
  }),
}));

import * as route from '@/app/auth/confirm/verify/route';

function formRequest(body: string, contentType = 'application/x-www-form-urlencoded') {
  return new NextRequest('http://localhost/auth/confirm/verify', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('/auth/confirm/verify', () => {
  beforeEach(() => {
    h.eq.mockClear();
    h.update.mockClear();
    h.from.mockClear();
    h.verifyOtp.mockReset();
    h.getUser.mockReset();
  });

  it('exposes no GET handler, so a scanner fetch cannot consume the token', () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it('rejects a request with no token without calling Supabase', async () => {
    const response = await route.POST(formRequest(''));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/auth?error=invalid_link');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a malformed body instead of throwing a 500', async () => {
    const response = await route.POST(formRequest('{"a":1}', 'application/json'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/auth?error=invalid_link');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it('sends a spent or expired token back to the sign-in screen with a reason', async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });

    const response = await route.POST(formRequest('token_hash=spent&type=recovery'));

    expect(h.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'spent' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/auth?error=invalid_link');
  });

  it('verifies a good recovery token, stamps the open, and lands on the password form', async () => {
    h.verifyOtp.mockResolvedValue({ error: null });
    h.getUser.mockResolvedValue({ data: { user: { id: 'student-1' } } });

    const response = await route.POST(formRequest('token_hash=good&type=recovery'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/auth/reset-password');
    expect(h.from).toHaveBeenCalledWith('students');
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ password_setup_started_at: expect.any(String) }),
    );
    expect(h.eq).toHaveBeenCalledWith('id', 'student-1');
  });

  // Used to be asserted with type=signup, which was an inert pass-through to the password form.
  // A signup confirmation now runs the admission decision and has its own suite in
  // auth-confirm-signup.test.ts, so this keeps the original guard using a type that IS still a
  // pass-through: only 'recovery' may stamp the recovery column.
  it('does not stamp the recovery column for a non-recovery confirmation', async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const response = await route.POST(formRequest('token_hash=good&type=email_change'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/auth/reset-password');
    expect(h.from).not.toHaveBeenCalled();
  });
});
