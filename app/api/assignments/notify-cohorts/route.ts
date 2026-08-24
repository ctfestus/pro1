import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { assignmentId, cohortIds, groupIds } = body;
  if (!assignmentId) return NextResponse.json({ error: 'assignmentId is required' }, { status: 400 });
  const hasCohorts = Array.isArray(cohortIds) && cohortIds.length > 0;
  const hasGroups  = Array.isArray(groupIds)  && groupIds.length  > 0;
  if (!hasCohorts && !hasGroups) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { data: assignment } = await supabase
    .from('assignments')
    .select('id, title, created_by')
    .eq('id', assignmentId)
    .maybeSingle();

  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('role').eq('id', user.id).single();
  const isAdmin = student?.role === 'admin';

  if (assignment.created_by !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await sendAssignmentNotifications({
      cohortIds: cohortIds ?? [],
      groupIds:  groupIds  ?? [],
      title:       assignment.title,
      contentType: 'assignment',
      formUrl:     '/student#assignments',
    });
  } catch (err) {
    console.error('[assignments/notify-cohorts] notification error:', err);
    return NextResponse.json({ error: 'Assignment saved but notification failed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
