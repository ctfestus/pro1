import { NextRequest, NextResponse, after } from 'next/server';
import { requireStudentUser, requireRole, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { sendPathNotification } from '@/lib/send-path-notification';
import { reconcilePathCompletion } from '@/lib/learning-path-progress';
import { countPathLearners } from '@/lib/learning-path-learners';
import { courseProgressPct } from '@/lib/course-progress';
import { veProgressPct } from '@/lib/ve-completion';

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

  const supabase = adminClient();
  const { data: paths, error } = await supabase
    .from('learning_paths')
    .select('*')
    .eq('instructor_id', user.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('[learning-paths] GET error:', error); return NextResponse.json({ error: 'Failed to fetch learning paths.' }, { status: 500 }); }

  const learnerCounts = await countPathLearners(supabase, paths ?? []);
  return NextResponse.json({
    paths: (paths ?? []).map((path: any) => ({ ...path, learner_count: learnerCounts[path.id] ?? 0 })),
  });
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

    const { title, description, cover_image, badge_image_url, item_ids, cohort_ids, status, next_path_id, request_id } = body;
    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (request_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id)) {
      return NextResponse.json({ error: 'request_id must be a UUID' }, { status: 400 });
    }

    const { data, error } = await supabase.from('learning_paths').insert({
      ...(request_id ? { id: request_id } : {}),
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

    if (error) {
      // The browser generates request_id once per new-path editor. If a response was lost
      // after the insert committed, retrying the same request reuses that row and never
      // sends the cohort notification a second time.
      if (error.code === '23505' && request_id) {
        const { data: existing } = await supabase.from('learning_paths')
          .select('id').eq('id', request_id).eq('instructor_id', user.id).maybeSingle();
        if (existing?.id) {
          return NextResponse.json({
            id: existing.id,
            reused: true,
            notification: { total: 0, sent: 0, failed: 0, skipped: true },
          });
        }
      }
      console.error('[learning-paths] create error:', error);
      return NextResponse.json({ error: 'Failed to create learning path.' }, { status: 500 });
    }

    let notification: any = null;
    if ((status ?? 'draft') === 'published' && (cohort_ids ?? []).length > 0) {
      try {
        notification = await sendPathNotification(
          supabase,
          { id: data.id, title: title.trim(), description, item_ids: item_ids ?? [] },
          cohort_ids,
        );
      } catch (err) {
        console.error('[learning-paths] create notify error:', err);
        notification = { total: 0, sent: 0, failed: null, error: 'Notification service unavailable.' };
      }
    }

    // The database insert is already committed. Notification problems are partial success,
    // never a failed save and never a reason for the client to issue another create.
    return NextResponse.json({ id: data.id, notification });
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

    // Send assignment emails to cohorts that are newly added (or path just published).
    // As with create, the update remains successful when delivery is only partial.
    let notification: any = null;
    if ((status ?? 'draft') === 'published' && (cohort_ids ?? []).length > 0) {
      const prevCohorts: string[] = prev?.cohort_ids ?? [];
      const wasPublished = prev?.status === 'published';
      const newCohorts = wasPublished
        ? (cohort_ids ?? []).filter((cid: string) => !prevCohorts.includes(cid))
        : cohort_ids ?? [];
      if (newCohorts.length > 0) {
        try {
          notification = await sendPathNotification(
            supabase,
            { id, title: title?.trim() ?? '', description, item_ids: item_ids ?? [] },
            newCohorts,
          );
        } catch (err) {
          console.error('[learning-paths] update notify error:', err);
          notification = { total: 0, sent: 0, failed: null, error: 'Notification service unavailable.' };
        }
      }
    }

    return NextResponse.json({ ok: true, id, notification });
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
    // Published only: an item unpublished after being added to a path must not leak its
    // metadata to students (it falls back to the Unknown placeholder below).
    const [{ data: coursesRaw }, { data: vesRaw }, { data: certsRaw }] = allItemIds.length
      ? await Promise.all([
          supabase.from('courses').select('id, title, slug, cover_image, description, questions').in('id', allItemIds).eq('status', 'published'),
          supabase.from('virtual_experiences').select('id, title, slug, cover_image, description, modules').in('id', allItemIds).eq('status', 'published'),
          supabase.from('certifications').select('id, title, slug, cover_image, description').in('id', allItemIds).eq('status', 'published'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const formMap: Record<string, any> = {};
    const courseQuestions = new Map<string, any[]>();
    const veModules = new Map<string, any[]>();
    for (const c of coursesRaw ?? []) {
      courseQuestions.set(c.id, c.questions ?? []);
      const { questions, ...course } = c;
      formMap[c.id] = { ...course, content_type: 'course' };
    }
    for (const v of vesRaw ?? []) {
      veModules.set(v.id, v.modules ?? []);
      const { modules, ...ve } = v;
      formMap[v.id] = { ...ve, content_type: 'virtual_experience' };
    }
    for (const t of certsRaw   ?? []) formMap[t.id] = { ...t, content_type: 'certification' };

    // Determine which items the student has actually completed by checking
    // course_attempts, guided_project_attempts and certification_attempts directly -- this
    // covers items completed before they were added to a learning path.
    const [{ data: courseAttempts }, { data: veAttempts }, { data: certAttempts }, learnerCounts] = await Promise.all([
      allItemIds.length
        ? supabase.from('course_attempts').select('course_id, answers, completed_at, passed, updated_at').eq('student_id', user.id).in('course_id', allItemIds).order('updated_at', { ascending: false })
        : { data: [] },
      allItemIds.length
        ? supabase.from('guided_project_attempts').select('ve_id, progress, completed_at, updated_at').eq('student_id', user.id).in('ve_id', allItemIds).order('updated_at', { ascending: false })
        : { data: [] },
      allItemIds.length
        ? supabase.from('certification_attempts').select('certification_id').eq('student_id', user.id).eq('passed', true).in('certification_id', allItemIds)
        : { data: [] },
      countPathLearners(supabase, paths),
    ]);

    const actuallyCompleted = new Set([
      ...(courseAttempts ?? []).filter((a: any) => a.passed === true && a.completed_at).map((a: any) => a.course_id),
      ...(veAttempts ?? []).filter((a: any) => a.completed_at).map((a: any) => a.ve_id),
      ...(certAttempts ?? []).map((a: any) => a.certification_id),
    ]);
    const inProgressPct = new Map<string, number>();
    for (const attempt of courseAttempts ?? []) {
      if (!attempt.completed_at && !inProgressPct.has(attempt.course_id)) {
        inProgressPct.set(attempt.course_id, courseProgressPct(courseQuestions.get(attempt.course_id) ?? [], attempt.answers ?? {}));
      }
    }
    for (const attempt of veAttempts ?? []) {
      if (!attempt.completed_at && !inProgressPct.has(attempt.ve_id)) {
        inProgressPct.set(attempt.ve_id, veProgressPct(veModules.get(attempt.ve_id) ?? [], attempt.progress ?? {}));
      }
    }

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
        learner_count: learnerCounts[path.id] ?? 0,
        progress: prog
          ? { ...prog, completed_item_ids: effectiveCompleted }
          : effectiveCompleted.length ? { completed_item_ids: effectiveCompleted, completed_at: null, cert_id: null } : null,
        items: (path.item_ids ?? []).map((id: string) => {
          const item = formMap[id] ?? { id, title: 'Unknown' };
          const pct = inProgressPct.get(id);
          return typeof pct === 'number' ? { ...item, in_progress_pct: pct } : item;
        }),
      };
    });

    // Historical attempts can complete every item without the stored progress ever being
    // finalized -- no completed_at, so no certificate, badge, or completion email. Reconcile
    // after the response is sent so those side effects run exactly once without slowing
    // the dashboard load.
    for (const p of result) {
      const itemIds: string[] = p.item_ids ?? [];
      const done: string[] = p.progress?.completed_item_ids ?? [];
      const finished = itemIds.length > 0 && itemIds.every((id: string) => done.includes(id));
      if (finished && (!p.progress?.completed_at || !p.progress?.cert_id)) {
        after(() => reconcilePathCompletion(supabase, user.id, { id: p.id, title: p.title, item_ids: itemIds, next_path_id: p.next_path_id }, done));
      }
    }

    return NextResponse.json({ paths: result });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

