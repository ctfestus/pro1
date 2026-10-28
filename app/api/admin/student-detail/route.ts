import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { veProgressPct } from '@/lib/ve-completion';
import { fetchAllRowsByIds } from '@/lib/fetch-all-rows';
import { pathTracks, trackOptOuts } from '@/lib/learning-path-tracks';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { serviceDb: supabase } = auth;

  const studentId = new URL(req.url).searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId required' }, { status: 400 });

  const [
    { data: student },
    { data: courseAttempts },
    { data: gpAttempts },
    { data: submissions },
    { data: groupMemberships },
    { data: certificates },
  ] = await Promise.all([
    supabase.from('students').select('id, full_name, email, cohort_id, created_at, last_login_at').eq('id', studentId).single(),
    supabase.from('course_attempts').select('course_id, score, passed, completed_at, updated_at').eq('student_id', studentId),
    supabase.from('guided_project_attempts').select('ve_id, progress, completed_at, updated_at').eq('student_id', studentId),
    supabase.from('assignment_submissions').select('assignment_id, status, score, submitted_at').eq('student_id', studentId),
    supabase.from('group_members').select('group_id').eq('student_id', studentId),
    supabase.from('certificates').select('id, form_id, course_id, issued_at').eq('student_id', studentId),
  ]);

  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

  const cohortId = student.cohort_id;
  const groupIds = (groupMemberships ?? []).map((m: any) => m.group_id as string);
  const [{ data: cohort }, { data: directCourses }, { data: cohortAssignments }, { data: groupAssignments }, { data: groupSubmissions }, { data: directVEs }, cohortPaths] = await Promise.all([
    cohortId ? supabase.from('cohorts').select('id, name').eq('id', cohortId).single() : Promise.resolve({ data: null }),
    cohortId ? supabase.from('courses').select('id, title, slug').contains('cohort_ids', [cohortId]).eq('status', 'published') : Promise.resolve({ data: [] as any[] }),
    cohortId ? supabase.from('assignments').select('id, title, type').contains('cohort_ids', [cohortId]) : Promise.resolve({ data: [] as any[] }),
    groupIds.length ? supabase.from('assignments').select('id, title, type').overlaps('group_ids', groupIds) : Promise.resolve({ data: [] as any[] }),
    groupIds.length ? supabase.from('assignment_submissions').select('assignment_id, status, score, submitted_at, participants').in('group_id', groupIds) : Promise.resolve({ data: [] as any[] }),
    cohortId ? supabase.from('virtual_experiences').select('id, title, slug, modules').contains('cohort_ids', [cohortId]).eq('status', 'published') : Promise.resolve({ data: [] as any[] }),
    // A published path assigned to the cohort grants every item in it without the cohort appearing
    // in the item's own cohort_ids, so a cohort taught only through a path has no direct content.
    cohortId ? supabase.from('learning_paths').select('id, item_ids, tracks, cohort_ids').contains('cohort_ids', [cohortId]).eq('status', 'published') : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  // A failed path read must fail the panel. Treated as empty, it shows "No courses in cohort" for
  // a learner whose whole programme is a path.
  if (cohortPaths.error) {
    console.error('[admin/student-detail] learning path lookup error:', cohortPaths.error);
    return NextResponse.json({ error: 'Failed to load student detail.' }, { status: 500 });
  }
  // On a path with tracks the other tracks' courses are not this learner's, so they must not show
  // as Not started. Same rule as the tracking report; a direct assignment still counts.
  const trackedPaths = (cohortPaths.data ?? []).filter((p: any) => pathTracks(p).length > 0);
  let optOuts = new Set<string>();
  if (trackedPaths.length) {
    const { data: picks, error: picksError } = await supabase.from('learning_path_progress')
      .select('learning_path_id, track_id').eq('student_id', studentId).in('learning_path_id', trackedPaths.map((p: any) => p.id));
    if (picksError) {
      console.error('[admin/student-detail] track lookup error:', picksError);
      return NextResponse.json({ error: 'Failed to load student detail.' }, { status: 500 });
    }
    const trackOf = new Map<string, string | null>((picks ?? []).map((r: any) => [`${studentId}|${r.learning_path_id}`, r.track_id ?? null]));
    optOuts = trackOptOuts(cohortPaths.data ?? [], [{ id: studentId, cohort_id: cohortId }], trackOf);
  }
  const directIds = new Set([...(directCourses ?? []), ...(directVEs ?? [])].map((c: any) => c.id as string));
  const pathItemIds = [...new Set((cohortPaths.data ?? []).flatMap((p: any) => (p.item_ids ?? []) as string[]))]
    .filter(id => !directIds.has(id) && !optOuts.has(`${studentId}|${id}`));
  let pathCourses: any[] = [];
  let pathVEs: any[] = [];
  try {
    [pathCourses, pathVEs] = await Promise.all([
      fetchAllRowsByIds<any>(pathItemIds, (chunk, from, to) => supabase
        .from('courses').select('id, title, slug', { count: 'exact' }).in('id', chunk).eq('status', 'published').order('id').range(from, to)),
      fetchAllRowsByIds<any>(pathItemIds, (chunk, from, to) => supabase
        .from('virtual_experiences').select('id, title, slug, modules', { count: 'exact' }).in('id', chunk).eq('status', 'published').order('id').range(from, to)),
    ]);
  } catch (err) {
    console.error('[admin/student-detail] path item lookup error:', err);
    return NextResponse.json({ error: 'Failed to load student detail.' }, { status: 500 });
  }
  const cohortCourses = [...(directCourses ?? []), ...pathCourses];
  const cohortVEs = [...(directVEs ?? []), ...pathVEs];

  const certSet = new Set((certificates ?? []).map((c: any) => c.form_id ?? c.course_id));
  const attemptMap = (courseAttempts ?? []).reduce((map: Record<string, any>, a: any) => {
    const ex = map[a.course_id];
    if (!ex) { map[a.course_id] = a; return map; }
    if (a.passed && a.completed_at && !ex.completed_at) { map[a.course_id] = a; return map; }
    if (ex.passed && ex.completed_at && !a.completed_at) return map;
    if (!a.completed_at && ex.completed_at && !ex.passed) { map[a.course_id] = a; return map; }
    if (a.completed_at && !a.passed && !ex.completed_at) return map;
    if (a.completed_at && (a.score ?? 0) > (ex.score ?? 0)) map[a.course_id] = a;
    if (!a.completed_at && !ex.completed_at && new Date(a.updated_at ?? 0) > new Date(ex.updated_at ?? 0)) map[a.course_id] = a;
    return map;
  }, {} as Record<string, any>);
  const participantGroupSubmissions = (groupSubmissions ?? [])
    .filter((s: any) => Array.isArray(s.participants) && s.participants.includes(studentId));
  const submMap    = Object.fromEntries([...participantGroupSubmissions, ...(submissions ?? [])].map((s: any) => [s.assignment_id, s]));
  const gpMap      = Object.fromEntries((gpAttempts ?? []).map((a: any) => [a.ve_id, a]));

  const courses = cohortCourses.map((c: any) => {
    const att = attemptMap[c.id];
    return {
      id: c.id, title: c.title, slug: c.slug,
      status: att ? (att.completed_at ? (att.passed === false ? 'failed' : 'completed') : 'in_progress') : 'not_started',
      score: att?.score ?? null,
      passed: att?.passed ?? null,
      hasCert: certSet.has(c.id),
    };
  });

  const assignmentById = new Map<string, any>();
  for (const a of [...(cohortAssignments ?? []), ...(groupAssignments ?? [])]) assignmentById.set(a.id, a);
  const assignments = Array.from(assignmentById.values()).map((a: any) => {
    const sub = submMap[a.id];
    return {
      id: a.id, title: a.title, type: a.type,
      status: sub ? sub.status : 'not_started',
      score: sub?.score ?? null,
      submittedAt: sub?.submitted_at ?? null,
    };
  });

  const ves = cohortVEs.map((v: any) => {
    const att = gpMap[v.id];
    // Shared rule, so a skipped optional LinkedIn share does not show as unfinished work.
    const pct = veProgressPct(v.modules ?? [], att?.progress ?? {});
    return {
      id: v.id, title: v.title, slug: v.slug,
      status: att ? (att.completed_at ? 'completed' : 'in_progress') : 'not_started',
      progressPct: att?.completed_at ? 100 : pct,
    };
  });

  return NextResponse.json({ student, cohort, courses, assignments, ves, certificates: certificates ?? [] });
}
