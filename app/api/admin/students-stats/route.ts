import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { fetchAllRows } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Org-wide per-student stats power the dashboard Students section -- staff never see it
  // (STAFF_SECTION_IDS excludes 'students'), so this is instructor/admin only.
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { supabase } = auth;

  // Every read here is paged. The attempts tables carry a row per student per completion, so
  // they pass the PostgREST row cap long before the student list does -- and the cap truncates
  // SILENTLY, which here does not look like an error: it looks like students who completed
  // nothing. Under-reporting progress is worse than failing, because nobody goes looking.
  const [completedCourses, completedVEs, courses, ves] = await Promise.all([
    fetchAllRows<{ student_id: string }>((from, to) => supabase
      .from('course_attempts').select('student_id, course_id', { count: 'exact' })
      .not('completed_at', 'is', null).order('id').range(from, to)),
    fetchAllRows<{ student_id: string }>((from, to) => supabase
      .from('guided_project_attempts').select('student_id, ve_id', { count: 'exact' })
      .not('completed_at', 'is', null).order('id').range(from, to)),
    fetchAllRows<{ cohort_ids: string[] | null }>((from, to) => supabase
      .from('courses').select('id, cohort_ids', { count: 'exact' })
      .eq('status', 'published').order('id').range(from, to)),
    fetchAllRows<{ cohort_ids: string[] | null }>((from, to) => supabase
      .from('virtual_experiences').select('id, cohort_ids', { count: 'exact' })
      .eq('status', 'published').order('id').range(from, to)),
  ]);

  // Per-student completed count (courses + VEs combined)
  const completedCount: Record<string, number> = {};
  for (const a of completedCourses) completedCount[a.student_id] = (completedCount[a.student_id] ?? 0) + 1;
  for (const a of completedVEs) completedCount[a.student_id] = (completedCount[a.student_id] ?? 0) + 1;

  // Per-cohort total content count (courses + VEs)
  const cohortContentCount: Record<string, number> = {};
  for (const c of courses) {
    for (const cid of (c.cohort_ids ?? [])) cohortContentCount[cid] = (cohortContentCount[cid] ?? 0) + 1;
  }
  for (const v of ves) {
    for (const cid of (v.cohort_ids ?? [])) cohortContentCount[cid] = (cohortContentCount[cid] ?? 0) + 1;
  }

  return NextResponse.json({ completedCount, cohortContentCount });
}
