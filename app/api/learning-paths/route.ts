import { NextRequest, NextResponse, after } from 'next/server';
import { requireStudentUser, requireRole, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { sendPathNotification } from '@/lib/send-path-notification';
import { reconcilePathCompletion } from '@/lib/learning-path-progress';
import { countPathLearners } from '@/lib/learning-path-learners';
import { courseProgressPct } from '@/lib/course-progress';
import { veProgressPct } from '@/lib/ve-completion';
import { normalizeTracks, tracksError, changedRequirements, pathTracks, chosenTrack, needsTrack, requiredItemIds, isPathComplete } from '@/lib/learning-path-tracks';
import { fetchAllRows } from '@/lib/fetch-all-rows';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * The 409 text when an edit would change what completers took. Names how many and which tracks.
 * Paged: past the row cap an unpaged read would silently undercount.
 */
async function completedConflictMessage(
  supabase: any,
  pathId: string,
  prev: { tracks?: unknown; item_ids?: string[] | null },
  changed: { trackIds: string[]; core: boolean },
): Promise<string> {
  const fallback = 'This change alters content learners already completed. Undo that change, or create a new path.';
  try {
    const completers = await fetchAllRows<{ track_id: string | null }>((from, to) => supabase
      .from('learning_path_progress').select('id, track_id', { count: 'exact' })
      .eq('learning_path_id', pathId).not('completed_at', 'is', null).order('id').range(from, to));
    const stranded = completers.filter(c => c.track_id ? changed.trackIds.includes(c.track_id) : changed.core);
    if (!stranded.length) return fallback;
    const prevNames = new Map(pathTracks(prev).map(t => [t.id, t.name] as [string, string]));
    const names = [...new Set(stranded.map(c => (c.track_id && prevNames.get(c.track_id)) || 'the core'))];
    const who = `${stranded.length} learner${stranded.length === 1 ? '' : 's'}`;
    return `This change alters the content ${who} already completed (${names.join(', ')}). Undo that change, or create a new path.`;
  } catch (err) {
    console.error('[learning-paths] completers lookup error:', err);
    return fallback;
  }
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

    const { title, description, cover_image, badge_image_url, item_ids, cohort_ids, status, next_path_id, request_id, available_to_everyone,
            overview, skills, who_should_take, tools, tracks } = body;
    // Open access replaces cohort targeting rather than adding to it -- the database enforces the
    // exclusion, so normalise here instead of failing the author on a constraint they cannot see.
    const openAccess = available_to_everyone === true;
    const targetCohorts: string[] = openAccess ? [] : (cohort_ids ?? []);
    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    const createTracksProblem = tracksError(tracks);
    if (createTracksProblem) return NextResponse.json({ error: createTracksProblem }, { status: 400 });
    if (request_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id)) {
      return NextResponse.json({ error: 'request_id must be a UUID' }, { status: 400 });
    }

    const { data, error } = await supabase.from('learning_paths').insert({
      ...(request_id ? { id: request_id } : {}),
      title: title.trim(),
      description: description ?? null,
      cover_image: cover_image ?? null,
      badge_image_url: badge_image_url ?? null,
      // What the path is FOR, as opposed to what it contains. Arrays default to empty so a path
      // saved before these existed simply shows fewer sections.
      overview: overview ?? null,
      skills: Array.isArray(skills) ? skills : [],
      who_should_take: Array.isArray(who_should_take) ? who_should_take : [],
      tools: Array.isArray(tools) ? tools : [],
      instructor_id: user.id,
      item_ids: item_ids ?? [],
      tracks: normalizeTracks(tracks, item_ids ?? []),
      cohort_ids: targetCohorts,
      available_to_everyone: openAccess,
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
    if ((status ?? 'draft') === 'published' && targetCohorts.length > 0) {
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

    const { id, title, description, cover_image, badge_image_url, item_ids, cohort_ids, status, next_path_id, available_to_everyone,
            overview, skills, who_should_take, tools, tracks } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    // Checked before saving: normalizeTracks would drop a bad track, silently making its items
    // core content required of everyone.
    const updateTracksProblem = tracksError(tracks);
    if (updateTracksProblem) return NextResponse.json({ error: updateTracksProblem }, { status: 400 });

    // Fetch previous state to detect newly published or newly added cohorts. Scoped to the owner,
    // like the write below: nothing about another instructor's path is read or revealed.
    const { data: prev, error: prevError } = await supabase.from('learning_paths')
      .select('status, cohort_ids, item_ids, tracks, updated_at')
      .eq('id', id)
      .eq('instructor_id', user.id)
      .maybeSingle();
    if (prevError) { console.error('[learning-paths] update lookup error:', prevError); return NextResponse.json({ error: 'Failed to update learning path.' }, { status: 500 }); }
    if (!prev) return NextResponse.json({ error: 'Learning path not found' }, { status: 404 });

    // A completed path keeps the track its certificate was issued for, and its learner can no
    // longer change track. So on a path with tracks (before or after this save), no change may
    // alter what a completer was required to take: not adding the first tracks (they would be
    // asked for a track they can never pick), not removing their track (including the last one,
    // which makes every former specialization required), and not moving items into or out of
    // their track or the core while keeping the track's id. changedRequirements names whose
    // required items differ; save_learning_path_shape (migration 226) locks the path row, checks
    // for completers on those and writes in one step, so a learner finishing at the same moment
    // cannot slip between the check and the write.
    let shapeSaved = false;
    if (tracks !== undefined || item_ids !== undefined) {
      const nextShape = {
        item_ids: (item_ids ?? prev.item_ids ?? []) as string[],
        tracks: tracks !== undefined ? tracks : prev.tracks,
      };
      if (pathTracks(nextShape).length > 0 || pathTracks(prev).length > 0) {
        const changed = changedRequirements(prev, nextShape);
        const { data: outcome, error: shapeError } = await supabase.rpc('save_learning_path_shape', {
          p_path_id:             id,
          p_instructor_id:       user.id,
          p_expected_updated_at: prev.updated_at,
          p_item_ids:            nextShape.item_ids,
          p_tracks:              normalizeTracks(nextShape.tracks, nextShape.item_ids),
          p_changed_track_ids:   changed.trackIds,
          p_core_changed:        changed.core,
        });
        if (shapeError) { console.error('[learning-paths] update shape error:', shapeError); return NextResponse.json({ error: 'Failed to update learning path.' }, { status: 500 }); }
        if (outcome === 'stale') {
          return NextResponse.json({ error: 'This path was changed elsewhere while you were saving. Reload it and try again.' }, { status: 409 });
        }
        if (outcome === 'completed') {
          return NextResponse.json({ error: await completedConflictMessage(supabase, id, prev, changed) }, { status: 409 });
        }
        if (outcome !== 'ok') { console.error('[learning-paths] update shape outcome:', outcome); return NextResponse.json({ error: 'Failed to update learning path.' }, { status: 500 }); }
        shapeSaved = true;
      }
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (title           !== undefined) updateData.title           = title.trim();
    if (description     !== undefined) updateData.description     = description;
    if (cover_image     !== undefined) updateData.cover_image     = cover_image;
    if (badge_image_url !== undefined) updateData.badge_image_url = badge_image_url ?? null;
    // Already written under the path lock when the path has tracks (above).
    if (!shapeSaved && item_ids !== undefined) updateData.item_ids = item_ids;
    // Tracks may only name items in the path, so they are cleaned against the item list being
    // saved (or the stored one when the request leaves items alone).
    if (!shapeSaved && tracks !== undefined) updateData.tracks = normalizeTracks(tracks, item_ids ?? prev.item_ids ?? []);
    if (overview        !== undefined) updateData.overview        = overview ?? null;
    if (skills          !== undefined) updateData.skills          = Array.isArray(skills) ? skills : [];
    if (who_should_take !== undefined) updateData.who_should_take = Array.isArray(who_should_take) ? who_should_take : [];
    if (tools           !== undefined) updateData.tools           = Array.isArray(tools) ? tools : [];
    if (cohort_ids      !== undefined) updateData.cohort_ids      = cohort_ids;
    // LAST word on access, deliberately after cohort_ids above: open access and cohort targeting
    // are mutually exclusive in the database, so a path being opened up must not also resubmit the
    // cohorts it used to target.
    if (available_to_everyone !== undefined) {
      updateData.available_to_everyone = available_to_everyone === true;
      if (available_to_everyone === true) updateData.cohort_ids = [];
    }
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
    // The cohorts this path ACTUALLY targets after the write, not the ones the request happened to
    // carry: a path being opened to everyone targets none, and must not email the cohorts it used
    // to belong to about an assignment it no longer has.
    const notifyCohorts: string[] = updateData.available_to_everyone === true
      ? []
      : (cohort_ids ?? []);
    if ((status ?? 'draft') === 'published' && notifyCohorts.length > 0) {
      const prevCohorts: string[] = prev?.cohort_ids ?? [];
      const wasPublished = prev?.status === 'published';
      const newCohorts = wasPublished
        ? notifyCohorts.filter((cid: string) => !prevCohorts.includes(cid))
        : notifyCohorts;
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

    // Get student's cohort (and name, for the track welcome)
    const { data: student } = await supabase
      .from('students')
      .select('cohort_id, full_name')
      .eq('id', user.id)
      .single();

    // Published paths this student can reach: their cohort's, plus any offered to everyone.
    // No cohort is not the same as no access -- a free account still gets the public ones.
    const cohortId = student?.cohort_id ?? null;
    const publishedPaths = supabase
      .from('learning_paths')
      .select('*')
      .eq('status', 'published');
    const { data: paths, error: pathsError } = await (cohortId
      ? publishedPaths.or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohortId}}`)
      : publishedPaths.eq('available_to_everyone', true));
    if (pathsError) { console.error('[learning-paths] student paths error:', pathsError); return NextResponse.json({ error: 'Could not load your learning paths.' }, { status: 500 }); }

    if (!paths?.length) return NextResponse.json({ paths: [] });
    const studentName: string | null = student?.full_name ?? null;

    // Fetch student's progress for those paths
    const pathIds = paths.map((p: any) => p.id);
    const { data: progRows, error: progError } = await supabase
      .from('learning_path_progress')
      .select('*')
      .eq('student_id', user.id)
      .in('learning_path_id', pathIds);
    // Read as empty, a failure looks like no track picked: the specialization disappears and the
    // learner is asked to choose again. Fail instead, so the dashboard shows its retry state.
    if (progError) { console.error('[learning-paths] student progress error:', progError); return NextResponse.json({ error: 'Could not load your learning paths.' }, { status: 500 }); }

    const progressMap: Record<string, any> = {};
    for (const p of progRows ?? []) progressMap[p.learning_path_id] = p;

    // Fetch content metadata for all item_ids across all paths
    const allItemIds = [...new Set(paths.flatMap((p: any) => p.item_ids ?? []))];
    const NO_ROWS = { data: [] as any[] };

    // One wave, and every read in it is narrow. The metadata reads never depended on the
    // attempt reads, so they no longer wait behind them. A student on a weak connection pays
    // for this route in bytes, and the authored content behind an item -- a course's
    // questions, a VE's modules -- is worth megabytes the screen never draws: it shows a
    // title, a cover, and a bar. Only an item still in progress needs enough of its content
    // to size that bar, and those are read below once the attempts say which items they are.
    // Attempts split the same way, so an answers blob only travels for an unfinished attempt.
    // Published only: an item unpublished after being added to a path must not leak its
    // metadata to students (it falls back to the Unknown placeholder below).
    const [
      { data: coursesRaw }, { data: vesRaw }, { data: certsRaw },
      { data: doneCourseAttempts }, { data: openCourseAttempts },
      { data: doneVeAttempts }, { data: openVeAttempts },
      { data: certAttempts }, learnerCounts,
    ] = await Promise.all([
      allItemIds.length
        ? supabase.from('courses').select('id, title, slug, cover_image, description').in('id', allItemIds).eq('status', 'published')
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('virtual_experiences').select('id, title, slug, cover_image, description').in('id', allItemIds).eq('status', 'published')
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('certifications').select('id, title, slug, cover_image, description').in('id', allItemIds).eq('status', 'published')
        : NO_ROWS,
      // Finished attempts decide the checkmarks and carry no JSON at all.
      allItemIds.length
        ? supabase.from('course_attempts').select('course_id, passed').eq('student_id', user.id).in('course_id', allItemIds).not('completed_at', 'is', null)
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('course_attempts').select('course_id, answers, updated_at').eq('student_id', user.id).in('course_id', allItemIds).is('completed_at', null).order('updated_at', { ascending: false })
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('guided_project_attempts').select('ve_id').eq('student_id', user.id).in('ve_id', allItemIds).not('completed_at', 'is', null)
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('guided_project_attempts').select('ve_id, progress, updated_at').eq('student_id', user.id).in('ve_id', allItemIds).is('completed_at', null).order('updated_at', { ascending: false })
        : NO_ROWS,
      allItemIds.length
        ? supabase.from('certification_attempts').select('certification_id').eq('student_id', user.id).eq('passed', true).in('certification_id', allItemIds)
        : NO_ROWS,
      countPathLearners(supabase, paths),
    ]);

    const formMap: Record<string, any> = {};
    for (const c of coursesRaw ?? []) formMap[c.id] = { ...c, content_type: 'course' };
    for (const v of vesRaw     ?? []) formMap[v.id] = { ...v, content_type: 'virtual_experience' };
    for (const t of certsRaw   ?? []) formMap[t.id] = { ...t, content_type: 'certification' };

    // Which items the student has actually completed, read from the attempt tables directly --
    // this covers items completed before they were added to a learning path.
    const actuallyCompleted = new Set([
      ...(doneCourseAttempts ?? []).filter((a: any) => a.passed === true).map((a: any) => a.course_id),
      ...(doneVeAttempts ?? []).map((a: any) => a.ve_id),
      ...(certAttempts ?? []).map((a: any) => a.certification_id),
    ]);

    // Most recent unfinished attempt per item, which is the one the ordered scan used to pick.
    const openCourse = new Map<string, any>();
    for (const a of openCourseAttempts ?? []) if (!openCourse.has(a.course_id)) openCourse.set(a.course_id, a);
    const openVe = new Map<string, any>();
    for (const a of openVeAttempts ?? []) if (!openVe.has(a.ve_id)) openVe.set(a.ve_id, a);

    // The only authored content this route still reads, and only for items mid-flight. A
    // student with nothing in progress -- the common case -- skips both reads entirely.
    const openCourseIds = [...openCourse.keys()];
    const openVeIds     = [...openVe.keys()];
    const [{ data: courseContent }, { data: veContent }] = await Promise.all([
      openCourseIds.length
        ? supabase.from('courses').select('id, questions').in('id', openCourseIds).eq('status', 'published')
        : NO_ROWS,
      openVeIds.length
        ? supabase.from('virtual_experiences').select('id, modules').in('id', openVeIds).eq('status', 'published')
        : NO_ROWS,
    ]);
    const questionsById = new Map<string, any[]>((courseContent ?? []).map((c: any) => [c.id, c.questions ?? []] as [string, any[]]));
    const modulesById   = new Map<string, any[]>((veContent ?? []).map((v: any) => [v.id, v.modules ?? []] as [string, any[]]));

    const inProgressPct = new Map<string, number>();
    for (const [id, attempt] of openCourse) {
      inProgressPct.set(id, courseProgressPct(questionsById.get(id) ?? [], attempt.answers ?? {}));
    }
    for (const [id, attempt] of openVe) {
      inProgressPct.set(id, veProgressPct(modulesById.get(id) ?? [], attempt.progress ?? {}));
    }

    const result = paths.map((path: any) => {
      const prog = progressMap[path.id] ?? null;
      // Merge: stored completed_item_ids + any items actually completed in attempts
      const storedIds: string[] = prog?.completed_item_ids ?? [];
      const effectiveCompleted = [...new Set([
        ...storedIds,
        ...(path.item_ids ?? []).filter((id: string) => actuallyCompleted.has(id)),
      ])];
      // A path with tracks is sent as this learner's own path: core + their track, so every
      // count and timeline on the client needs no track logic. Before a track is chosen that is
      // the core, with needs_track telling the client to ask for one.
      const trackId: string | null = chosenTrack(path, prog?.track_id) ? prog.track_id : null;
      const myItemIds = requiredItemIds(path, trackId);
      return {
        ...path,
        item_ids: myItemIds,
        tracks: pathTracks(path).map(t => ({ id: t.id, name: t.name, description: t.description ?? null, item_count: t.item_ids.length })),
        track_id: trackId,
        needs_track: needsTrack(path, trackId),
        learner_count: learnerCounts[path.id] ?? 0,
        progress: prog
          ? { ...prog, completed_item_ids: effectiveCompleted }
          : effectiveCompleted.length ? { completed_item_ids: effectiveCompleted, completed_at: null, cert_id: null } : null,
        items: myItemIds.map((id: string) => {
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
      const done: string[] = p.progress?.completed_item_ids ?? [];
      const source = paths.find((x: any) => x.id === p.id);
      const finished = isPathComplete(source, p.track_id, done);
      if (finished && (!p.progress?.completed_at || !p.progress?.cert_id)) {
        // The STORED track_id is the concurrency token: after a track is removed the response
        // reads it as null, but the row still holds the old id until the learner picks again.
        const storedTrackId: string | null = progressMap[p.id]?.track_id ?? null;
        after(() => reconcilePathCompletion(supabase, user.id, { id: p.id, title: p.title, item_ids: p.item_ids, next_path_id: p.next_path_id, updated_at: source?.updated_at ?? null }, done, storedTrackId));
      }
    }

    return NextResponse.json({ paths: result, student_name: studentName });
  }

  // -- Student: pick (or switch) their track on a path with tracks ---
  if (action === 'choose-track') {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { path_id, track_id } = body;
    if (typeof path_id !== 'string' || typeof track_id !== 'string') {
      return NextResponse.json({ error: 'path_id and track_id are required' }, { status: 400 });
    }

    const [{ data: student }, { data: path }, { data: prog, error: progError }] = await Promise.all([
      supabase.from('students').select('cohort_id').eq('id', user.id).single(),
      supabase.from('learning_paths').select('id, item_ids, tracks, cohort_ids, available_to_everyone, status').eq('id', path_id).maybeSingle(),
      supabase.from('learning_path_progress').select('completed_at, cert_id').eq('student_id', user.id).eq('learning_path_id', path_id).maybeSingle(),
    ]);
    if (progError) { console.error('[learning-paths] choose-track progress error:', progError); return NextResponse.json({ error: 'Could not save your track.' }, { status: 500 }); }
    // Same reach rule as get-student-paths: published, and open or assigned to their cohort.
    const reachable = path?.status === 'published'
      && (path.available_to_everyone === true || (!!student?.cohort_id && (path.cohort_ids ?? []).includes(student.cohort_id)));
    if (!path || !reachable) return NextResponse.json({ error: 'Learning path not found' }, { status: 404 });
    if (!chosenTrack(path, track_id)) return NextResponse.json({ error: 'That track is not part of this path' }, { status: 400 });
    // A finished path keeps the track its certificate was issued for.
    if (prog?.completed_at || prog?.cert_id) {
      return NextResponse.json({ error: 'You have completed this path, so its track can no longer be changed.' }, { status: 409 });
    }

    // Written only while the path is unfinished, in the same statement, so a completion landing
    // between the check above and this write cannot be given a different track afterwards.
    // Completion takes the other side (complete_learning_path_progress only finalizes the track it
    // was computed for), so the two cannot interleave.
    const completedNow = NextResponse.json({ error: 'You have completed this path, so its track can no longer be changed.' }, { status: 409 });
    const saveFailed = (err: unknown) => {
      console.error('[learning-paths] choose-track error:', err);
      return NextResponse.json({ error: 'Could not save your track.' }, { status: 500 });
    };
    const switchTrack = () => supabase.from('learning_path_progress')
      .update({ track_id, updated_at: new Date().toISOString() })
      .eq('student_id', user.id).eq('learning_path_id', path_id)
      .is('completed_at', null).is('cert_id', null)
      .select('id');
    if (prog) {
      const { data: rows, error } = await switchTrack();
      if (error) return saveFailed(error);
      if (!rows?.length) return completedNow;
    } else {
      const { error } = await supabase.from('learning_path_progress')
        .insert({ student_id: user.id, learning_path_id: path_id, track_id });
      if (error?.code === '23505') {
        // The row appeared since the read (another tab, or a completion): switch it under the
        // same unfinished-only condition.
        const { data: rows, error: retryError } = await switchTrack();
        if (retryError) return saveFailed(retryError);
        if (!rows?.length) return completedNow;
      } else if (error) {
        return saveFailed(error);
      }
    }

    // Completion (when the core and the track's items are already done) is picked up by the
    // reconciliation in get-student-paths, which the client reloads next.
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

