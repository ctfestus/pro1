/**
 * POST /api/cohort-assignments
 * Upserts rows in cohort_assignments for the given content + cohort list.
 * Uses INSERT ... ON CONFLICT DO NOTHING so the original assigned_at is preserved
 * when cohorts are re-added after being removed.
 * For events: auto-registers all students in newly added cohorts and sends each
 * a personalised confirmation email with their tracked join link.
 * For other content types: sends generic assignment notification emails.
 *
 * DELETE /api/cohort-assignments
 * Removes a single row from cohort_assignments for a given content + cohort pair.
 * Called when a cohort is unassigned from content via the cohort page, so that a
 * future re-assignment is treated as genuinely new and triggers notification emails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';
import { autoRegisterEventCohorts } from '@/lib/auto-register-event-cohorts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // newCohortIds supplied by caller (computed from old cohort_ids snapshot before save) is authoritative.
  // Fallback to inferring from cohort_assignments only when the caller omits it (older integrations).
  const { formId, cohortIds, newCohortIds: callerNewCohortIds } = body;
  if (!formId) return NextResponse.json({ error: 'formId is required' }, { status: 400 });
  if (!Array.isArray(cohortIds)) return NextResponse.json({ error: 'cohortIds is required' }, { status: 400 });

  // Look up content across courses, events, and virtual_experiences
  const [{ data: course }, { data: event }, { data: ve }] = await Promise.all([
    supabase.from('courses').select('id, title, slug, status').eq('id', formId).eq('user_id', user.id).maybeSingle(),
    supabase.from('events').select('id, title, slug, status').eq('id', formId).eq('user_id', user.id).maybeSingle(),
    supabase.from('virtual_experiences').select('id, title, slug, status').eq('id', formId).eq('user_id', user.id).maybeSingle(),
  ]);

  let content: any = null;
  let contentType: string = '';

  if (course)      { content = course; contentType = 'course'; }
  else if (event)  { content = event;  contentType = 'event'; }
  else if (ve)     { content = ve;     contentType = 'virtual_experience'; }

  if (!content) return NextResponse.json({ error: 'Content not found' }, { status: 404 });

  // Fetch existing rows to determine what to delete
  const { data: existing } = await supabase
    .from('cohort_assignments')
    .select('cohort_id')
    .eq('content_id', formId);

  const existingSet      = new Set((existing ?? []).map((r: { cohort_id: string }) => r.cohort_id));
  const removedCohortIds = [...existingSet].filter((id: string) => !cohortIds.includes(id));

  // Delete rows for cohorts no longer in the list so re-adding them later triggers a fresh notification
  if (removedCohortIds.length) {
    const { error: delErr } = await supabase
      .from('cohort_assignments')
      .delete()
      .eq('content_id', formId)
      .in('cohort_id', removedCohortIds);
    if (delErr) console.error('[cohort-assignments] delete stale rows error:', delErr);
  }

  if (!cohortIds.length) return NextResponse.json({ ok: true });

  // Upsert -- ON CONFLICT DO NOTHING preserves the original assigned_at
  const rows = cohortIds.map((cohortId: string) => ({
    content_id:   formId,
    content_type: contentType,
    cohort_id:    cohortId,
  }));
  const { error } = await supabase
    .from('cohort_assignments')
    .upsert(rows, { onConflict: 'content_id,cohort_id', ignoreDuplicates: true });

  if (error) {
    console.error('[cohort-assignments] upsert error:', error);
    return NextResponse.json({ error: 'Failed to save cohort assignments.' }, { status: 500 });
  }

  // Only email for published content
  if (content.status !== 'published') return NextResponse.json({ ok: true });

  // Use caller-supplied new cohort list if provided; fall back to inferring from cohort_assignments
  const emailCohortIds: string[] = Array.isArray(callerNewCohortIds)
    ? callerNewCohortIds
    : cohortIds.filter((id: string) => !existingSet.has(id));

  if (!emailCohortIds.length) return NextResponse.json({ ok: true });

  if (contentType === 'event') {
    // Events: auto-register each student and send a personalised confirmation email
    try {
      await autoRegisterEventCohorts(supabase, formId, emailCohortIds);
    } catch (err) {
      console.error('[cohort-assignments] event auto-register error:', err);
      return NextResponse.json({ error: 'Assigned but event registration/notification failed.' }, { status: 500 });
    }
  } else if (content.slug) {
    // Courses / VEs: generic assignment notification
    try {
      await sendAssignmentNotifications({
        cohortIds: emailCohortIds,
        title:       content.title,
        slug:        content.slug,
        contentType,
      });
    } catch (err) {
      console.error('[cohort-assignments] notification error:', err);
      return NextResponse.json({ error: 'Assigned but notification email failed to send.' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { contentId, cohortId } = body;
  if (!contentId) return NextResponse.json({ error: 'contentId is required' }, { status: 400 });
  if (!cohortId)  return NextResponse.json({ error: 'cohortId is required' },  { status: 400 });

  // Verify the caller owns the content before deleting
  const [{ data: course }, { data: event }, { data: ve }] = await Promise.all([
    supabase.from('courses').select('id').eq('id', contentId).eq('user_id', user.id).maybeSingle(),
    supabase.from('events').select('id').eq('id', contentId).eq('user_id', user.id).maybeSingle(),
    supabase.from('virtual_experiences').select('id').eq('id', contentId).eq('user_id', user.id).maybeSingle(),
  ]);

  if (!course && !event && !ve) {
    // Also allow admins
    const { data: student } = await supabase.from('students').select('role').eq('id', user.id).single();
    if (student?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from('cohort_assignments')
    .delete()
    .eq('content_id', contentId)
    .eq('cohort_id', cohortId);

  if (error) {
    console.error('[cohort-assignments] delete error:', error);
    return NextResponse.json({ error: 'Failed to remove cohort assignment.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
