import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { sendPathNotification } from '@/lib/send-path-notification';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { learningPathId, cohortIds } = body;
  if (!learningPathId) return NextResponse.json({ error: 'learningPathId is required' }, { status: 400 });
  if (!Array.isArray(cohortIds) || !cohortIds.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { data: lp } = await supabase
    .from('learning_paths')
    .select('id, title, description, item_ids, instructor_id')
    .eq('id', learningPathId)
    .maybeSingle();

  if (!lp) return NextResponse.json({ error: 'Learning path not found' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('role').eq('id', user.id).single();
  const isAdmin = student?.role === 'admin';

  if (lp.instructor_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const notification = await sendPathNotification(supabase, lp, cohortIds);
    if (notification.failed > 0) {
      return NextResponse.json({ ok: false, notification }, { status: 502 });
    }
    return NextResponse.json({ ok: true, notification });
  } catch (err) {
    console.error('[learning-paths/notify-cohorts] error:', err);
    return NextResponse.json({ error: 'Notification failed.' }, { status: 500 });
  }
}
