import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, requireRole, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { sendPathNotification } from '@/lib/send-path-notification';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getSessionUser(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase() };
}

// Authoring (list/create/update/delete) writes through the service-role client and can
// publish to arbitrary cohorts with notification emails -- instructors and admins only.
// Students only ever use the get-student-paths action.
async function getInstructorUser(req: NextRequest): Promise<{ id: string; email: string } | NextResponse> {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error; // 401 unauthenticated, 403 wrong role
  if (!auth.user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase() };
}

export const dynamic = 'force-dynamic';

// GET -- instructor fetches their own learning paths
export async function GET(req: NextRequest) {
  const user = await getInstructorUser(req);
  if (user instanceof NextResponse) return user;

  const { data: paths, error } = await adminClient()
    .from('learning_paths')
    .select('*')
    .eq('instructor_id', user.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('[learning-paths] GET error:', error); return NextResponse.json({ error: 'Failed to fetch learning paths.' }, { status: 500 }); }
  return NextResponse.json({ paths: paths ?? [] });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action } = body;
  const supabase = adminClient();

  // -- Create ---
  if (action === 'create') {
    const user = await getInstructorUser(req);
    if (user instanceof NextResponse) return user;

    const { title, description, cover_image, badge_image_url, item_ids, cohort_ids, status, next_path_id } = body;
    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    const { data, error } = await supabase.from('learning_paths').insert({
      title: title.trim(),
      description: description ?? null,
      cover_image: cover_image ?? null,
      badge_image_url: badge_image_url ?? null,
      instructor_id: user.id,
      item_ids: item_ids ?? [],
      cohort_ids: cohort_ids ?? [],
      status: status ?? 'draft',
      next_path_id: next_path_id ?? null,
    }).select('id').single();

    if (error) { console.error('[learning-paths] create error:', error); return NextResponse.json({ error: 'Failed to create learning path.' }, { status: 500 }); }

    // Send assignment emails if published with cohorts
    if ((status ?? 'draft') === 'published' && (cohort_ids ?? []).length > 0) {
      try {
        await sendPathNotification(supabase, { id: data.id, title: title.trim(), description, item_ids: item_ids ?? [] }, cohort_ids);
      } catch (err) {
        console.error('[learning-paths] create notify error:', err);
        return NextResponse.json({ error: 'Saved but notification emails failed to send.' }, { status: 500 });
      }
    }

    return NextResponse.json({ id: data.id });
  }

  // -- Update ---
  if (action === 'update') {
    const user = await getInstructorUser(req);
    if (user instanceof NextResponse) return user;

    const { id, title, description, cover_image, badge_image_url, item_ids, cohort_ids, status, next_path_id } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Fetch previous state to detect newly published or newly added cohorts
    const { data: prev } = await supabase.from('learning_paths').select('status, cohort_ids').eq('id', id).single();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (title           !== undefined) updateData.title           = title.trim();
    if (description     !== undefined) updateData.description     = description;
    if (cover_image     !== undefined) updateData.cover_image     = cover_image;
    if (badge_image_url !== undefined) updateData.badge_image_url = badge_image_url ?? null;
    if (item_ids        !== undefined) updateData.item_ids        = item_ids;
    if (cohort_ids      !== undefined) updateData.cohort_ids      = cohort_ids;
    if (status          !== undefined) updateData.status          = status;
    if (next_path_id    !== undefined) updateData.next_path_id    = next_path_id ?? null;

    const { error } = await supabase.from('learning_paths')
      .update(updateData)
      .eq('id', id)
      .eq('instructor_id', user.id);

    if (error) { console.error('[learning-paths] update error:', error); return NextResponse.json({ error: 'Failed to update learning path.' }, { status: 500 }); }

    // Send assignment emails to cohorts that are newly added (or path just published)
    if ((status ?? 'draft') === 'published' && (cohort_ids ?? []).length > 0) {
      const prevCohorts: string[] = prev?.cohort_ids ?? [];
      const wasPublished = prev?.status === 'published';
      const newCohorts = wasPublished
        ? (cohort_ids ?? []).filter((cid: string) => !prevCohorts.includes(cid))
        : cohort_ids ?? []; // just published -- notify all cohorts
      if (newCohorts.length > 0) {
        try {
          await sendPathNotification(supabase, { id, title: title?.trim() ?? '', description, item_ids: item_ids ?? [] }, newCohorts);
        } catch (err) {
          console.error('[learning-paths] update notify error:', err);
          return NextResponse.json({ error: 'Saved but notification emails failed to send.' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  }

  // -- Delete ---
  if (action === 'delete') {
    const user = await getInstructorUser(req);
    if (user instanceof NextResponse) return user;

    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await supabase.from('learning_paths')
      .delete()
      .eq('id', id)
      .eq('instructor_id', user.id);

    if (error) { console.error('[learning-paths] delete error:', error); return NextResponse.json({ error: 'Failed to delete learning path.' }, { status: 500 }); }
    return NextResponse.json({ ok: true });
  }

  // -- Student: get enrolled paths with progress ---
  if (action === 'get-student-paths') {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get student's cohort
    const { data: student } = await supabase
      .from('students')
      .select('cohort_id')
      .eq('id', user.id)
      .single();

    if (!student?.cohort_id) return NextResponse.json({ paths: [] });

    // Fetch published paths that include student's cohort
    const { data: paths } = await supabase
      .from('learning_paths')
      .select('*')
      .eq('status', 'published')
      .contains('cohort_ids', [student.cohort_id]);

    if (!paths?.length) return NextResponse.json({ paths: [] });

    // Fetch student's progress for those paths
    const pathIds = paths.map((p: any) => p.id);
    const { data: progRows } = await supabase
      .from('learning_path_progress')
      .select('*')
      .eq('student_id', user.id)
      .in('learning_path_id', pathIds);

    const progressMap: Record<string, any> = {};
    for (const p of progRows ?? []) progressMap[p.learning_path_id] = p;

    // Fetch content metadata for all item_ids across all paths
    const allItemIds = [...new Set(paths.flatMap((p: any) => p.item_ids ?? []))];
    const [{ data: coursesRaw }, { data: vesRaw }] = allItemIds.length
      ? await Promise.all([
          supabase.from('courses').select('id, title, slug, cover_image, description').in('id', allItemIds),
          supabase.from('virtual_experiences').select('id, title, slug, cover_image, description').in('id', allItemIds),
        ])
      : [{ data: [] }, { data: [] }];

    const formMap: Record<string, any> = {};
    for (const c of coursesRaw ?? []) formMap[c.id] = { ...c, content_type: 'course' };
    for (const v of vesRaw     ?? []) formMap[v.id] = { ...v, content_type: 'virtual_experience' };

    // Determine which items the student has actually completed by checking
    // course_attempts and guided_project_attempts directly -- this covers
    // courses completed before the learning path feature was deployed.
    const [{ data: courseAttempts }, { data: veAttempts }] = await Promise.all([
      allItemIds.length
        ? supabase.from('course_attempts').select('course_id').eq('student_id', user.id).eq('passed', true).not('completed_at', 'is', null).in('course_id', allItemIds)
        : { data: [] },
      allItemIds.length
        ? supabase.from('guided_project_attempts').select('ve_id').eq('student_id', user.id).not('completed_at', 'is', null).in('ve_id', allItemIds)
        : { data: [] },
    ]);

    const actuallyCompleted = new Set([
      ...(courseAttempts ?? []).map((a: any) => a.course_id),
      ...(veAttempts ?? []).map((a: any) => a.ve_id),
    ]);

    const result = paths.map((path: any) => {
      const prog = progressMap[path.id] ?? null;
      // Merge: stored completed_item_ids + any items actually completed in attempts
      const storedIds: string[] = prog?.completed_item_ids ?? [];
      const effectiveCompleted = [...new Set([
        ...storedIds,
        ...(path.item_ids ?? []).filter((id: string) => actuallyCompleted.has(id)),
      ])];
      return {
        ...path,
        progress: prog
          ? { ...prog, completed_item_ids: effectiveCompleted }
          : effectiveCompleted.length ? { completed_item_ids: effectiveCompleted, completed_at: null, cert_id: null } : null,
        items: (path.item_ids ?? []).map((id: string) => formMap[id] ?? { id, title: 'Unknown' }),
      };
    });

    return NextResponse.json({ paths: result });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

