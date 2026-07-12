import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireStudentUser, requireUser } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  let body: { studentId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  if (!body.studentId) return NextResponse.json({ error: 'studentId is required.' }, { status: 400 });

  const [{ data: actorProfile }, { data: targetProfile }] = await Promise.all([
    auth.supabase.from('students').select('role').eq('id', auth.actor.id).maybeSingle(),
    auth.supabase.from('students').select('id, full_name, email, role').eq('id', body.studentId).maybeSingle(),
  ]);
  if (!actorProfile || !['admin', 'instructor'].includes(actorProfile.role)) {
    return NextResponse.json({ error: 'Student Mode is restricted to instructors and admins.' }, { status: 403 });
  }
  if (!targetProfile || targetProfile.role !== 'student') {
    return NextResponse.json({ error: 'The selected Student Mode account is invalid.' }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const { data: modeSession, error: sessionError } = await auth.supabase.from('student_mode_sessions').insert({
    actor_id: auth.actor.id,
    student_id: targetProfile.id,
    expires_at: expiresAt,
    user_agent: req.headers.get('user-agent'),
  }).select('id, started_at, expires_at').single();
  if (sessionError || !modeSession) {
    console.error('[student-mode/start]', sessionError?.message);
    return NextResponse.json({ error: 'Could not start Student Mode.' }, { status: 500 });
  }

  const { error: auditError } = await auth.supabase.from('student_mode_audit_log').insert({
    actor_id: auth.actor.id,
    student_id: targetProfile.id,
    session_id: modeSession.id,
    action: 'student_mode.started',
  });
  if (auditError) {
    await auth.supabase.from('student_mode_sessions').delete().eq('id', modeSession.id);
    console.error('[student-mode/start-audit]', auditError.message);
    return NextResponse.json({ error: 'Student Mode audit is unavailable.' }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    context: {
      sessionId: modeSession.id,
      studentId: targetProfile.id,
      name: targetProfile.full_name || targetProfile.email,
      email: targetProfile.email,
      startedAt: modeSession.started_at,
      expiresAt: modeSession.expires_at,
    },
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;
  if (!auth.isStudentMode) return NextResponse.json({ error: 'Student Mode is not active.' }, { status: 400 });
  const { data: target } = await auth.supabase.from('students').select('full_name, email').eq('id', auth.user.id).single();
  return NextResponse.json({ ok: true, studentId: auth.user.id, name: target?.full_name || target?.email, email: target?.email });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const sessionId = req.headers.get('x-student-mode-session')?.trim();
  if (!sessionId) return NextResponse.json({ ok: true });
  const { data: modeSession } = await auth.supabase.from('student_mode_sessions')
    .select('id, student_id').eq('id', sessionId).eq('actor_id', auth.actor.id).maybeSingle();
  if (modeSession) {
    await auth.supabase.from('student_mode_sessions').update({ ended_at: new Date().toISOString() }).eq('id', modeSession.id);
    const { error: auditError } = await auth.supabase.from('student_mode_audit_log').insert({
      actor_id: auth.actor.id, student_id: modeSession.student_id, session_id: modeSession.id, action: 'student_mode.exited',
    });
    if (auditError) console.error('[student-mode/exit-audit]', auditError.message);
  }
  return NextResponse.json({ ok: true });
}
