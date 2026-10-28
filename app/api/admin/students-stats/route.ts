import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';
import { pathTracks, trackOptOuts } from '@/lib/learning-path-tracks';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Org-wide per-student stats power the dashboard Students section -- staff never see it
  // (STAFF_SECTION_IDS excludes 'students'), so this is instructor/admin only.
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { serviceDb: supabase } = auth;

  // Every read here is paged. The attempts tables carry a row per student per completion, so
  // they pass the PostgREST row cap long before the student list does -- and the cap truncates
  // SILENTLY, which here does not look like an error: it looks like students who completed
  // nothing. Under-reporting progress is worse than failing, because nobody goes looking.
  const [completedCourses, completedVEs, courses, ves, paths] = await Promise.all([
    fetchAllRows<{ student_id: string; course_id: string }>((from, to) => supabase
      // A finished attempt with passed = false is a fail, which the detail panel labels as such.
      .from('course_attempts').select('student_id, course_id', { count: 'exact' })
      .not('completed_at', 'is', null).or('passed.is.null,passed.eq.true').order('id').range(from, to)),
    fetchAllRows<{ student_id: string; ve_id: string }>((from, to) => supabase
      .from('guided_project_attempts').select('student_id, ve_id', { count: 'exact' })
      .not('completed_at', 'is', null).order('id').range(from, to)),
    fetchAllRows<{ id: string; cohort_ids: string[] | null }>((from, to) => supabase
      .from('courses').select('id, cohort_ids', { count: 'exact' })
      .eq('status', 'published').order('id').range(from, to)),
    fetchAllRows<{ id: string; cohort_ids: string[] | null }>((from, to) => supabase
      .from('virtual_experiences').select('id, cohort_ids', { count: 'exact' })
      .eq('status', 'published').order('id').range(from, to)),
    // A published path grants its cohorts every item in it without the cohort appearing in the
    // item's own cohort_ids, so a cohort taught only through a path would otherwise count 0.
    fetchAllRows<{ id: string; item_ids: string[] | null; tracks: unknown; cohort_ids: string[] | null }>((from, to) => supabase
      .from('learning_paths').select('id, item_ids, tracks, cohort_ids', { count: 'exact' })
      .eq('status', 'published').order('id').range(from, to)),
  ]);

  // Per-student completed count (courses + VEs combined). Distinct items, not attempt rows: a
  // retake writes another completed attempt, which would count the same course again.
  const completedItems: Record<string, Set<string>> = {};
  const markCompleted = (studentId: string, itemId: string) => {
    (completedItems[studentId] ??= new Set()).add(itemId);
  };
  for (const a of completedCourses) markCompleted(a.student_id, a.course_id);
  for (const a of completedVEs) markCompleted(a.student_id, a.ve_id);
  const completedCount: Record<string, number> = {};
  for (const [studentId, items] of Object.entries(completedItems)) completedCount[studentId] = items.size;

  // Per-cohort total content count (courses + VEs), direct assignments plus published path items.
  // Only published courses and VEs count; a path's certifications and unpublished items do not.
  const cohortItems: Record<string, Set<string>> = {};
  const addCohortItem = (cohortId: string, itemId: string) => {
    (cohortItems[cohortId] ??= new Set()).add(itemId);
  };
  const publishedIds = new Set<string>();
  const directKeys = new Set<string>();
  for (const c of [...courses, ...ves]) {
    publishedIds.add(c.id);
    for (const cid of (c.cohort_ids ?? [])) {
      addCohortItem(cid, c.id);
      directKeys.add(`${cid}|${c.id}`);
    }
  }
  for (const p of paths) {
    for (const itemId of (p.item_ids ?? [])) {
      if (!publishedIds.has(itemId)) continue;
      for (const cid of (p.cohort_ids ?? [])) addCohortItem(cid, itemId);
    }
  }
  const cohortContentCount: Record<string, number> = {};
  for (const [cohortId, items] of Object.entries(cohortItems)) cohortContentCount[cohortId] = items.size;

  // On a path with tracks a learner takes the core plus their own track, so their total differs
  // from the cohort's. Sent per student only where it differs; the table falls back to the cohort.
  // Their Completed count follows the same rule: another track's course they finished anyway is
  // not part of their programme, and counting it would show more completed than assigned.
  const studentContentCount: Record<string, number> = {};
  const trackedPaths = paths.filter(p => pathTracks(p).length > 0);
  if (trackedPaths.length) {
    const trackedCohorts = [...new Set(trackedPaths.flatMap(p => p.cohort_ids ?? []))];
    const [students, picks] = await Promise.all([
      fetchAllRowsByIds<{ id: string; cohort_id: string | null }>(trackedCohorts, (chunk, from, to) => supabase
        .from('students').select('id, cohort_id', { count: 'exact' }).in('cohort_id', chunk).order('id').range(from, to)),
      fetchAllRowsByIds<{ student_id: string; learning_path_id: string; track_id: string | null }>(trackedPaths.map(p => p.id), (chunk, from, to) => supabase
        .from('learning_path_progress').select('id, student_id, learning_path_id, track_id', { count: 'exact' })
        .in('learning_path_id', chunk).order('id').range(from, to)),
    ]);
    const trackOf = new Map<string, string | null>(picks.map(r => [`${r.student_id}|${r.learning_path_id}`, r.track_id ?? null]));
    const optOuts = trackOptOuts(paths, students, trackOf);
    for (const s of students) {
      if (!s.cohort_id) continue;
      const items = cohortItems[s.cohort_id] ?? new Set<string>();
      let total = 0;
      for (const itemId of items) {
        if (optOuts.has(`${s.id}|${itemId}`) && !directKeys.has(`${s.cohort_id}|${itemId}`)) continue;
        total++;
      }
      if (total !== items.size) studentContentCount[s.id] = total;
      const done = completedItems[s.id];
      if (done) {
        let completed = 0;
        for (const itemId of done) {
          if (optOuts.has(`${s.id}|${itemId}`) && !directKeys.has(`${s.cohort_id}|${itemId}`)) continue;
          completed++;
        }
        completedCount[s.id] = completed;
      }
    }
  }

  return NextResponse.json({ completedCount, cohortContentCount, studentContentCount });
}
