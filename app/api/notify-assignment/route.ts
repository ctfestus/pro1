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

  const { formId, cohortIds: explicitCohortIds } = body;
  if (!formId) return NextResponse.json({ error: 'formId is required' }, { status: 400 });

  // Look up the content across all three tables
  const [c, e, v] = await Promise.all([
    supabase.from('courses').select('user_id, title, slug, status, cohort_ids').eq('id', formId).maybeSingle(),
    supabase.from('events').select('user_id, title, slug, status, cohort_ids').eq('id', formId).maybeSingle(),
    supabase.from('virtual_experiences').select('user_id, title, slug, status, cohort_ids').eq('id', formId).maybeSingle(),
  ]);

  let content: any = null;
  let contentType: string = '';

  if (c.data)      { content = c.data; contentType = 'course'; }
  else if (e.data) { content = e.data; contentType = 'event'; }
  else if (v.data) { content = v.data; contentType = 'virtual_experience'; }

  if (!content) return NextResponse.json({ error: 'Content not found' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('role').eq('id', user.id).single();
  const isAdmin = student?.role === 'admin';

  if (content.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (content.status !== 'published') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Use caller-supplied list when provided (only newly added cohorts); fall back to all cohort_ids
  const cohortIds: string[] = Array.isArray(explicitCohortIds) && explicitCohortIds.length
    ? explicitCohortIds
    : (content.cohort_ids ?? []);

  if (!cohortIds.length) return NextResponse.json({ ok: true, skipped: true });

  try {
    await sendAssignmentNotifications({
      cohortIds,
      title:       content.title || '',
      slug:        content.slug  || '',
      contentType,
    });
  } catch (err) {
    console.error('[notify-assignment] notification error:', err);
    return NextResponse.json({ error: 'Notification email failed to send.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
