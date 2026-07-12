import { describe, it, expect, vi, beforeEach } from 'vitest';

// Layer A: unit-test the shared auth helpers by mocking the service-role client at the
// @/lib/admin-client seam. We control what auth.getUser() and the students-role lookup
// return, and assert the helper's decisions (401 / 403 / 503 / pass).

const getUser = vi.fn();
const single = vi.fn();
const maybeSingle = vi.fn();
const insert = vi.fn();

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    auth: { getUser },
    // eq() is chainable so a query can filter on several columns
    // (student_mode_sessions is looked up by id AND actor_id) before resolving.
    from: () => {
      const chain: any = { eq: () => chain, single, maybeSingle };
      return { select: () => chain, insert };
    },
  }),
}));

import { requireUser, requireStudentUser, requireRole, isAuthError } from '@/lib/api-auth';
import { NextRequest } from 'next/server';

function req(headers: Record<string, string> = {}, method = 'GET') {
  return new NextRequest('http://localhost/api/test', { headers, method });
}
const bearer = { authorization: 'Bearer valid-token' };
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  getUser.mockReset();
  single.mockReset();
  maybeSingle.mockReset();
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
});

describe('requireUser', () => {
  it('401 when no Authorization header', async () => {
    const r = await requireUser(req());
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(401);
  });

  it('401 when token is invalid', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const r = await requireUser(req(bearer));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(401);
  });

  it('returns the JWT owner and never impersonates', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } }, error: null });
    // A stray Student Mode header must be ignored by requireUser -- only
    // requireStudentUser honors it.
    const r = await requireUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }));
    expect(isAuthError(r)).toBe(false);
    if (!isAuthError(r)) {
      expect(r.user.id).toBe('u1');
      expect(r.actor.id).toBe('u1');
      expect(r.isStudentMode).toBe(false);
      expect(r.token).toBe('valid-token');
    }
  });
});

describe('requireStudentUser', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'instructor-1', email: 'teacher@example.com' } }, error: null });
  });

  it('returns the plain actor when no Student Mode header is present', async () => {
    const r = await requireStudentUser(req(bearer));
    expect(isAuthError(r)).toBe(false);
    if (!isAuthError(r)) {
      expect(r.user.id).toBe('instructor-1');
      expect(r.isStudentMode).toBe(false);
    }
  });

  it('impersonates the student for a valid session (no audit on GET)', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'student-1', expires_at: future(), ended_at: null } })
      .mockResolvedValueOnce({ data: { id: 'student-1', email: 'student@example.com', role: 'student' } });

    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }));
    expect(isAuthError(r)).toBe(false);
    if (!isAuthError(r)) {
      expect(r.user).toEqual({ id: 'student-1', email: 'student@example.com' });
      expect(r.actor.id).toBe('instructor-1');
      expect(r.isStudentMode).toBe(true);
      expect(r.studentModeSessionId).toBe('sess-1');
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it('403 when the session is not found (or belongs to another actor)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-x' }));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('403 when the session has expired', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'student-1', expires_at: past(), ended_at: null } });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('403 when the session has been ended', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'student-1', expires_at: future(), ended_at: past() } });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('403 when the selected target is not a student', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'instructor-2', expires_at: future(), ended_at: null } })
      .mockResolvedValueOnce({ data: { id: 'instructor-2', email: 'other@example.com', role: 'instructor' } });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('writes an audit row on a mutating request', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'student-1', expires_at: future(), ended_at: null } })
      .mockResolvedValueOnce({ data: { id: 'student-1', email: 'student@example.com', role: 'student' } });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }, 'POST'));
    expect(isAuthError(r)).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('503 (and takes no action) when the audit write fails on a mutating request', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: 'sess-1', student_id: 'student-1', expires_at: future(), ended_at: null } })
      .mockResolvedValueOnce({ data: { id: 'student-1', email: 'student@example.com', role: 'student' } });
    insert.mockResolvedValueOnce({ error: { message: 'insert failed' } });
    const r = await requireStudentUser(req({ ...bearer, 'x-student-mode-session': 'sess-1' }, 'POST'));
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(503);
  });
});

describe('requireRole', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } }, error: null });
  });

  it('403 when the role is not allowed', async () => {
    single.mockResolvedValue({ data: { role: 'student' } });
    const r = await requireRole(req(bearer), ['admin', 'instructor']);
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('403 when the student row is missing', async () => {
    single.mockResolvedValue({ data: null });
    const r = await requireRole(req(bearer), ['admin', 'instructor']);
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(403);
  });

  it('passes and exposes the role when allowed', async () => {
    single.mockResolvedValue({ data: { role: 'instructor' } });
    const r = await requireRole(req(bearer), ['admin', 'instructor']);
    expect(isAuthError(r)).toBe(false);
    if (!isAuthError(r)) expect(r.role).toBe('instructor');
  });

  it('401 (not 403) when unauthenticated -- never reaches the role check', async () => {
    const r = await requireRole(req(), ['admin']);
    expect(isAuthError(r)).toBe(true);
    if (isAuthError(r)) expect(r.error.status).toBe(401);
  });
});
