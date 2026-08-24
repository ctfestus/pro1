/**
 * Unified server-side cohort content assignment/unassignment.
 *
 * POST  - assign a single cohort to a piece of content:
 *   reads cohort_ids as source of truth (not cohort_assignments),
 *   updates cohort_ids, syncs cohort_assignments, sends notification.
 *
 * DELETE - unassign a single cohort from a piece of content:
 *   updates cohort_ids, deletes from cohort_assignments (so re-assignment
 *   is treated as genuinely new and triggers notification emails).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';
import { sendPathNotification } from '@/lib/send-path-notification';

export const dynamic = 'force-dynamic';

// Tables the cohort page can assign content from
const OWNER_COL: Record<string, string> = {
  courses:             'user_id',
  virtual_experiences: 'user_id',
  assignments:         'created_by',
  learning_paths:      'instructor_id',
};

// content_type values for cohort_assignments table
// (only 'course' and 'virtual_experience' are supported by the schema constraint)
const CA_CONTENT_TYPE: Record<string, string | null> = {
  courses:             'course',
  virtual_experiences: 'virtual_experience',
  assignments:         null,
  learning_paths:      null,
};

// Columns to fetch per table
const SELECT_COLS: Record<string, string> = {
  courses:             'id, title, slug, status, cohort_ids, available_to_everyone, user_id',
  virtual_experiences: 'id, title, slug, status, cohort_ids, user_id',
  assignments:         'id, title, status, cohort_ids, created_by',
  learning_paths:      'id, title, description, item_ids, status, cohort_ids, instructor_id',
};

async function fetchAndVerify(
  supabase: any,
  userId: string,
  table: string,
  contentId: string,
): Promise<any | null> {
  const cols = SELECT_COLS[table];
  const ownerCol = OWNER_COL[table];
  const { data } = await supabase.from(table).select(cols).eq('id', contentId).maybeSingle();
  if (!data) return null;
  if (data[ownerCol] !== userId) {
    const { data: s } = await supabase.from('students').select('role').eq('id', userId).single();
    if (s?.role !== 'admin' && s?.role !== 'staff') return null;
  }
  return data;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { contentId, contentTable, cohortId, confirmRestriction } = body;
  if (!contentId)    return NextResponse.json({ error: 'contentId is required' },    { status: 400 });
  if (!contentTable) return NextResponse.json({ error: 'contentTable is required' }, { status: 400 });
  if (!cohortId)     return NextResponse.json({ error: 'cohortId is required' },     { status: 400 });
  if (!OWNER_COL[contentTable]) return NextResponse.json({ error: 'Invalid contentTable' }, { status: 400 });

  // Validate cohort exists (basic ownership -- cohorts.created_by would be a stricter check)
  const { data: cohort } = await supabase.from('cohorts').select('id').eq('id', cohortId).maybeSingle();
  if (!cohort) return NextResponse.json({ error: 'Cohort not found' }, { status: 404 });

  const content = await fetchAndVerify(supabase, user.id, contentTable, contentId);
  if (!content) return NextResponse.json({ error: 'Content not found or forbidden' }, { status: 403 });

  // Server-side: only published content may be assigned
  if (content.status !== 'published') {
    return NextResponse.json({ error: 'Only published content can be assigned to a cohort.' }, { status: 400 });
  }

  // Use cohort_ids as source of truth -- never cohort_assignments -- so stale rows cannot block emails
  const currentIds: string[] = Array.isArray(content.cohort_ids) ? content.cohort_ids : [];
  if (currentIds.includes(cohortId)) {
    return NextResponse.json({ ok: true, alreadyAssigned: true });
  }

  if (contentTable === 'courses' && content.available_to_everyone === true && confirmRestriction !== true) {
    return NextResponse.json({
      error: 'This course is currently available to everyone. Assigning it to a cohort will restrict access to selected cohorts only.',
      requiresConfirmation: true,
    }, { status: 409 });
  }

  // 1. Update cohort_ids on the content
  // Unlike paid subscription-plan assignment, which rejects globally free content as
  // likely configuration error, narrowing a course to a teaching cohort is a normal
  // administrative action. It is allowed only after the explicit confirmation above.
  // A confirmed retry reaches this point through a fresh request and fresh content read.
  const nextCohortIds = [...currentIds, cohortId];
  const assignmentUpdate = contentTable === 'courses'
    ? { cohort_ids: nextCohortIds, available_to_everyone: false }
    : { cohort_ids: nextCohortIds };
  const { error: updateError } = await supabase
    .from(contentTable)
    .update(assignmentUpdate)
    .eq('id', contentId);

  if (updateError) {
    console.error('[cohort-content-assignment] update error:', updateError);
    return NextResponse.json({ error: 'Failed to update assignment.' }, { status: 500 });
  }

  // 2. Sync cohort_assignments (only for types the schema supports)
  const caContentType = CA_CONTENT_TYPE[contentTable];
  if (caContentType) {
    const { error: upsertError } = await supabase
      .from('cohort_assignments')
      .upsert(
        { content_id: contentId, content_type: caContentType, cohort_id: cohortId },
        { onConflict: 'content_id,cohort_id', ignoreDuplicates: true },
      );
    if (upsertError) {
      console.error('[cohort-content-assignment] cohort_assignments upsert error:', upsertError);
    }
  }

  // 3. Send notification
  let notifyError: string | null = null;
  try {
    if (contentTable === 'courses' || contentTable === 'virtual_experiences') {
      await sendAssignmentNotifications({
        cohortIds:   [cohortId],
        title:       content.title,
        slug:        content.slug,
        contentType: caContentType!,
      });
    } else if (contentTable === 'assignments') {
      await sendAssignmentNotifications({
        cohortIds:   [cohortId],
        title:       content.title,
        contentType: 'assignment',
        formUrl:     '/student#assignments',
      });
    } else if (contentTable === 'learning_paths') {
      await sendPathNotification(supabase, content, [cohortId]);
    }
  } catch (err) {
    console.error('[cohort-content-assignment] notification error:', err);
    notifyError = 'Assigned, but notification email failed to send.';
  }

  return NextResponse.json({ ok: true, cohortIds: nextCohortIds, ...(notifyError ? { notifyError } : {}) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { contentId, contentTable, cohortId } = body;
  if (!contentId)    return NextResponse.json({ error: 'contentId is required' },    { status: 400 });
  if (!contentTable) return NextResponse.json({ error: 'contentTable is required' }, { status: 400 });
  if (!cohortId)     return NextResponse.json({ error: 'cohortId is required' },     { status: 400 });
  if (!OWNER_COL[contentTable]) return NextResponse.json({ error: 'Invalid contentTable' }, { status: 400 });

  const content = await fetchAndVerify(supabase, user.id, contentTable, contentId);
  if (!content) return NextResponse.json({ error: 'Content not found or forbidden' }, { status: 403 });

  const currentIds: string[] = Array.isArray(content.cohort_ids) ? content.cohort_ids : [];
  if (!currentIds.includes(cohortId)) {
    return NextResponse.json({ ok: true, alreadyRemoved: true });
  }

  // 1. Update cohort_ids (remove cohort)
  const { error: updateError } = await supabase
    .from(contentTable)
    .update({ cohort_ids: currentIds.filter((id: string) => id !== cohortId) })
    .eq('id', contentId);

  if (updateError) {
    console.error('[cohort-content-assignment] unassign update error:', updateError);
    return NextResponse.json({ error: 'Failed to remove assignment.' }, { status: 500 });
  }

  // 2. Delete from cohort_assignments (so re-assignment triggers a fresh notification)
  const { error: deleteError } = await supabase
    .from('cohort_assignments')
    .delete()
    .eq('content_id', contentId)
    .eq('cohort_id', cohortId);

  if (deleteError) {
    console.error('[cohort-content-assignment] cohort_assignments delete error:', deleteError);
    // Non-fatal: cohort_ids was updated successfully
  }

  return NextResponse.json({ ok: true });
}
