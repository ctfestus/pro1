// Shared API auth for route handlers. Centralizes Bearer-token parsing, service-role
// user verification, and role checks so every route enforces them the same way instead
// of hand-rolling the pattern (and risking a forgotten check).
//
// Roles come from students.role -- never the profiles table.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';

type Supabase = ReturnType<typeof adminClient>;

export interface AuthedUser {
  user: { id: string; email?: string };
  /** JWT owner. Always the real authenticated account. */
  actor: { id: string; email?: string };
  isStudentMode: boolean;
  studentModeSessionId?: string;
  supabase: Supabase;
  /** The verified Bearer JWT -- for routes that need a user-scoped (RLS) client. */
  token: string;
}
export interface AuthedRole extends AuthedUser {
  role: string;
}

/** Narrow an auth result: returns true (and gives TS the error response) when auth failed. */
export function isAuthError<T>(r: T | { error: NextResponse }): r is { error: NextResponse } {
  return (r as { error?: NextResponse }).error instanceof NextResponse;
}

/**
 * Verify the Bearer token and return the authenticated user + a service-role client.
 * On failure returns `{ error: NextResponse }` (401) -- callers do:
 *   const auth = await requireUser(req); if (isAuthError(auth)) return auth.error;
 */
export async function requireUser(req: NextRequest): Promise<AuthedUser | { error: NextResponse }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const jwt = authHeader.slice(7);
  const supabase = adminClient();
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const actor = { id: user.id, email: user.email ?? undefined };
  return { user: actor, actor, isStudentMode: false, supabase, token: jwt };
}

/**
 * Explicit capability boundary for learner-facing routes. Normal `requireUser`
 * never changes identity; only routes that opt into this helper may act on a
 * selected student's records.
 */
export async function requireStudentUser(req: NextRequest): Promise<AuthedUser | { error: NextResponse }> {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth;

  const sessionId = req.headers.get('x-student-mode-session')?.trim();
  if (!sessionId) return auth;

  const { data: modeSession, error: sessionError } = await auth.supabase
    .from('student_mode_sessions')
    .select('id, student_id, expires_at, ended_at')
    .eq('id', sessionId)
    .eq('actor_id', auth.actor.id)
    .maybeSingle();
  const expired = !modeSession?.expires_at || new Date(modeSession.expires_at).getTime() <= Date.now();
  if (sessionError || !modeSession || modeSession.ended_at || expired) {
    return { error: NextResponse.json({ error: 'Student Mode session is invalid or expired.' }, { status: 403 }) };
  }

  const { data: targetProfile } = await auth.supabase
    .from('students')
    .select('id, email, role')
    .eq('id', modeSession.student_id)
    .maybeSingle();
  if (!targetProfile || targetProfile.role !== 'student') {
    return { error: NextResponse.json({ error: 'The selected Student Mode account is invalid.' }, { status: 403 }) };
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const { error: auditError } = await auth.supabase.from('student_mode_audit_log').insert({
      actor_id: auth.actor.id,
      student_id: targetProfile.id,
      session_id: modeSession.id,
      action: `${req.method} ${req.nextUrl.pathname}`,
      metadata: { path: req.nextUrl.pathname, phase: 'requested' },
    });
    if (auditError) {
      console.error('[student-mode/audit]', auditError.message);
      return { error: NextResponse.json({ error: 'Student Mode audit is unavailable. No action was taken.' }, { status: 503 }) };
    }
  }

  return {
    ...auth,
    user: { id: targetProfile.id, email: targetProfile.email ?? undefined },
    isStudentMode: true,
    studentModeSessionId: modeSession.id,
  };
}

/**
 * Like requireUser, but also requires the caller's students.role to be in `allowedRoles`.
 * Returns 401 if unauthenticated, 403 if the role is not allowed.
 */
export async function requireRole(
  req: NextRequest,
  allowedRoles: string[],
): Promise<AuthedRole | { error: NextResponse }> {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth;

  const { data: student } = await auth.supabase
    .from('students')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (!student || !allowedRoles.includes(student.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ...auth, role: student.role };
}
