import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { fetchAllRows, fetchAllRowsByIds, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';
import { courseProgressPct } from '@/lib/course-progress';
import { veProgressPct } from '@/lib/ve-completion';
import {
  summarizeLearnerProgress, sourceForCohortKind,
  type PathReport, type PathReportItem, type PathReportLearner, type PathReportCohort, type EnrollmentSource,
} from '@/lib/learning-path-report';

export const dynamic = 'force-dynamic';

// GET /api/learning-paths/report?pathId=
//
// Per-learner progress on one learning path, for the owner of the path (admins and staff see any
// path). The population is everyone who can reach the path -- bootcamp cohorts and subscription
// plans alike, since a plan grants access through its own cohort in cohort_ids -- plus anyone with
// recorded progress on it (an expired subscriber keeps their history), plus, for a path open to
// everyone, anyone who has started one of its items.

const STUDENT_COLS = 'id, email, full_name, status, cohort_id';

// A failed read must fail the report. Treated as empty, it would turn real items into "Removed
// content" and real progress into "not started" -- numbers that look right and are not.
function must(res: { data: any; error?: any }): any[] {
  if (res.error) throw new Error(res.error.message ?? 'Query failed');
  return res.data ?? [];
}

function later(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, role, serviceDb: supabase } = auth;

  const pathId = new URL(req.url).searchParams.get('pathId');
  if (!pathId) return NextResponse.json({ error: 'pathId is required' }, { status: 400 });

  const { data: path, error: pathError } = await supabase
    .from('learning_paths')
    .select('id, title, status, instructor_id, item_ids, cohort_ids, available_to_everyone')
    .eq('id', pathId)
    .maybeSingle();
  if (pathError) {
    console.error('[learning-paths/report] path lookup error:', pathError);
    return NextResponse.json({ error: 'Failed to build the learning path report.' }, { status: 500 });
  }
  if (!path) return NextResponse.json({ error: 'Learning path not found' }, { status: 404 });
  if (role === 'instructor' && path.instructor_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const itemIds: string[] = path.item_ids ?? [];
    const pathCohortIds: string[] = path.cohort_ids ?? [];
    const NO_ROWS = { data: [] as any[] };

    // -- Items, in path order. item_ids carries no type, so resolve it from whichever table has the id.
    const [courseMetaRes, veMetaRes, certMetaRes] = itemIds.length
      ? await Promise.all([
          supabase.from('courses').select('id, title').in('id', itemIds),
          supabase.from('virtual_experiences').select('id, title').in('id', itemIds),
          supabase.from('certifications').select('id, title').in('id', itemIds),
        ])
      : [NO_ROWS, NO_ROWS, NO_ROWS];
    const courseMeta = must(courseMetaRes);
    const veMeta = must(veMetaRes);
    const certMeta = must(certMetaRes);
    const meta = new Map<string, PathReportItem>();
    for (const c of courseMeta ?? []) meta.set(c.id, { id: c.id, title: c.title, kind: 'course' });
    for (const v of veMeta ?? []) meta.set(v.id, { id: v.id, title: v.title, kind: 'virtual_experience' });
    for (const t of certMeta ?? []) meta.set(t.id, { id: t.id, title: t.title, kind: 'certification' });
    // A deleted item still counts toward the total on the learner side, so it does here too.
    const items: PathReportItem[] = itemIds.map(id => meta.get(id) ?? { id, title: 'Removed content', kind: 'course' });
    const courseIds = items.filter(i => i.kind === 'course' && meta.has(i.id)).map(i => i.id);
    const veIds = items.filter(i => i.kind === 'virtual_experience').map(i => i.id);
    const certIds = items.filter(i => i.kind === 'certification').map(i => i.id);

    // -- Population
    const [cohortStudents, progressRows] = await Promise.all([
      fetchAllRowsByIds<any>(pathCohortIds, (chunk, from, to) => supabase
        .from('students').select(STUDENT_COLS, { count: 'exact' })
        .in('cohort_id', chunk).eq('role', 'student').order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase
        .from('learning_path_progress').select('id, student_id, completed_item_ids, completed_at, cert_id, updated_at', { count: 'exact' })
        .eq('learning_path_id', path.id).order('id').range(from, to)),
    ]);

    const activityIds = new Set<string>(progressRows.map((p: any) => p.student_id).filter(Boolean));
    if (path.available_to_everyone) {
      const discovered = await Promise.all([
        fetchAllRowsByIds<any>(courseIds, (chunk, from, to) => supabase
          .from('course_attempts').select('student_id', { count: 'exact' }).in('course_id', chunk).order('id').range(from, to)),
        fetchAllRowsByIds<any>(veIds, (chunk, from, to) => supabase
          .from('guided_project_attempts').select('student_id', { count: 'exact' }).in('ve_id', chunk).order('id').range(from, to)),
        fetchAllRowsByIds<any>(certIds, (chunk, from, to) => supabase
          .from('certification_attempts').select('student_id', { count: 'exact' }).in('certification_id', chunk).order('id').range(from, to)),
      ]);
      for (const a of discovered.flat()) if (a.student_id) activityIds.add(a.student_id);
    }
    if (!path.available_to_everyone) {
      // Expiry clears students.cohort_id, and a subscriber who lapsed mid-item may have attempts but
      // no stored progress row. Their subscription still names the plan cohort, so find them there.
      // Lapsed subscribers with nothing done are dropped once progress is known, below.
      const lapsedSubs = await fetchAllRowsByIds<any>(pathCohortIds, (chunk, from, to) => supabase
        .from('individual_subscriptions').select('id, student_id', { count: 'exact' })
        .in('cohort_id', chunk).neq('status', 'active').order('id').range(from, to));
      for (const sub of lapsedSubs) if (sub.student_id) activityIds.add(sub.student_id);
    }
    const inCohorts = new Set(cohortStudents.map((s: any) => s.id));
    const extraIds = [...activityIds].filter(id => !inCohorts.has(id));
    const extraStudents = await fetchAllRowsByIds<any>(extraIds, (chunk, from, to) => supabase
      .from('students').select(STUDENT_COLS, { count: 'exact' })
      .in('id', chunk).eq('role', 'student').order('id').range(from, to));
    const students: any[] = [...cohortStudents, ...extraStudents];
    const studentIds = students.map(s => s.id);

    // -- Attempts on the path items, plus enrolment context
    const studentCohortIds = [...new Set([...pathCohortIds, ...students.map(s => s.cohort_id).filter(Boolean)])];
    const [courseAttempts, openCourseAttempts, veAttempts, openVeAttempts, certAttempts, cohortRows, subscriptions, assignments] = await Promise.all([
      fetchAllRowsByIdPairs<any>(studentIds, courseIds, (s, c, from, to) => supabase
        .from('course_attempts').select('student_id, course_id, passed, score, completed_at, updated_at', { count: 'exact' })
        .in('student_id', s).in('course_id', c).order('id').range(from, to)),
      // Answers only travel for unfinished attempts, which are the only ones that need a percentage.
      fetchAllRowsByIdPairs<any>(studentIds, courseIds, (s, c, from, to) => supabase
        .from('course_attempts').select('student_id, course_id, answers, updated_at', { count: 'exact' })
        .in('student_id', s).in('course_id', c).is('completed_at', null).order('id').range(from, to)),
      fetchAllRowsByIdPairs<any>(studentIds, veIds, (s, v, from, to) => supabase
        .from('guided_project_attempts').select('student_id, ve_id, completed_at, updated_at', { count: 'exact' })
        .in('student_id', s).in('ve_id', v).order('id').range(from, to)),
      fetchAllRowsByIdPairs<any>(studentIds, veIds, (s, v, from, to) => supabase
        .from('guided_project_attempts').select('student_id, ve_id, progress, updated_at', { count: 'exact' })
        .in('student_id', s).in('ve_id', v).is('completed_at', null).order('id').range(from, to)),
      fetchAllRowsByIdPairs<any>(studentIds, certIds, (s, c, from, to) => supabase
        .from('certification_attempts').select('student_id, certification_id, passed, score, completed_at, updated_at', { count: 'exact' })
        .in('student_id', s).in('certification_id', c).order('id').range(from, to)),
      fetchAllRowsByIds<any>(studentCohortIds, (chunk, from, to) => supabase
        .from('cohorts').select('id, name, cohort_kind', { count: 'exact' }).in('id', chunk).order('id').range(from, to)),
      fetchAllRowsByIds<any>(studentIds, (chunk, from, to) => supabase
        .from('individual_subscriptions').select('id, student_id, plan_id, cohort_id, status, current_period_end, created_at', { count: 'exact' })
        .in('student_id', chunk).order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase
        .from('cohort_assignments').select('id, cohort_id, assigned_at', { count: 'exact' })
        .eq('content_id', path.id).eq('content_type', 'learning_path').order('id').range(from, to)),
    ]);

    // Plan names, both for a plan cohort on the path and for the plan a learner holds (or held).
    const cohortById = new Map<string, any>(cohortRows.map((c: any) => [c.id, c]));
    const planCohortIds = cohortRows.filter((c: any) => c.cohort_kind === 'subscription_plan').map((c: any) => c.id);
    const planIds = [...new Set(subscriptions.map((s: any) => s.plan_id).filter(Boolean))] as string[];
    const [plansByCohort, plansById] = await Promise.all([
      fetchAllRowsByIds<any>(planCohortIds, (chunk, from, to) => supabase
        .from('subscription_plans').select('id, name, cohort_id', { count: 'exact' }).in('cohort_id', chunk).order('id').range(from, to)),
      fetchAllRowsByIds<any>(planIds, (chunk, from, to) => supabase
        .from('subscription_plans').select('id, name, cohort_id', { count: 'exact' }).in('id', chunk).order('id').range(from, to)),
    ]);
    const planNameByCohort = new Map<string, string>();
    const planNameById = new Map<string, string>();
    for (const p of [...plansByCohort, ...plansById]) { planNameByCohort.set(p.cohort_id, p.name); planNameById.set(p.id, p.name); }
    const cohortLabel = (id: string | null): string | null => {
      if (!id) return null;
      return planNameByCohort.get(id) ?? cohortById.get(id)?.name ?? null;
    };

    // -- In-progress percentages, reading authored content only for items someone is mid-way through.
    const latestOpen = <T extends { student_id: string; updated_at: string | null }>(rows: T[], key: (r: T) => string) => {
      const map = new Map<string, T>();
      for (const r of rows) {
        const k = `${r.student_id}::${key(r)}`;
        const prev = map.get(k);
        if (!prev || (r.updated_at ?? '') > (prev.updated_at ?? '')) map.set(k, r);
      }
      return map;
    };
    const openCourse = latestOpen(openCourseAttempts, r => r.course_id);
    const openVe = latestOpen(openVeAttempts, r => r.ve_id);
    const openCourseIds = [...new Set([...openCourse.values()].map((a: any) => a.course_id))];
    const openVeIds = [...new Set([...openVe.values()].map((a: any) => a.ve_id))];
    const [courseContentRes, veContentRes] = await Promise.all([
      openCourseIds.length ? supabase.from('courses').select('id, questions').in('id', openCourseIds) : NO_ROWS,
      openVeIds.length ? supabase.from('virtual_experiences').select('id, modules').in('id', openVeIds) : NO_ROWS,
    ]);
    const courseContent = must(courseContentRes);
    const veContent = must(veContentRes);
    const questionsById = new Map<string, any[]>((courseContent ?? []).map((c: any) => [c.id, c.questions ?? []] as [string, any[]]));
    const modulesById = new Map<string, any[]>((veContent ?? []).map((v: any) => [v.id, v.modules ?? []] as [string, any[]]));
    const openPctByStudent = new Map<string, Map<string, number>>();
    const setPct = (studentId: string, itemId: string, pct: number) => {
      const m = openPctByStudent.get(studentId) ?? new Map<string, number>();
      m.set(itemId, pct);
      openPctByStudent.set(studentId, m);
    };
    for (const a of openCourse.values()) setPct(a.student_id, a.course_id, courseProgressPct(questionsById.get(a.course_id) ?? [], a.answers ?? {}));
    for (const a of openVe.values()) setPct(a.student_id, a.ve_id, veProgressPct(modulesById.get(a.ve_id) ?? [], a.progress ?? {}));

    // -- Group per learner
    const group = <T extends { student_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const r of rows) { const list = map.get(r.student_id); if (list) list.push(r); else map.set(r.student_id, [r]); }
      return map;
    };
    const courseByStudent = group(courseAttempts);
    const veByStudent = group(veAttempts);
    const certByStudent = group(certAttempts);
    const progressByStudent = new Map<string, any>(progressRows.map((p: any) => [p.student_id, p]));
    const subByStudent = new Map<string, any>(subscriptions.map((s: any) => [s.student_id, s]));
    const assignedAt = new Map<string, string>(assignments.map((a: any) => [a.cohort_id, a.assigned_at]));
    const pathCohorts = new Set(pathCohortIds);

    const learners: PathReportLearner[] = students.map((s: any) => {
      const prog = progressByStudent.get(s.id);
      const sub = subByStudent.get(s.id);
      const onPath = !!s.cohort_id && pathCohorts.has(s.cohort_id);
      const source: EnrollmentSource = onPath
        ? sourceForCohortKind(cohortById.get(s.cohort_id)?.cohort_kind)
        : path.available_to_everyone ? 'open' : 'former';
      // A subscriber joins at the later of: the plan getting the path, or the learner getting the plan.
      const enrolledAt = onPath
        ? later(assignedAt.get(s.cohort_id) ?? null, source === 'subscriber' ? sub?.created_at : null)
        : null;
      const summary = summarizeLearnerProgress({
        items,
        storedCompletedIds: prog?.completed_item_ids ?? [],
        courseAttempts: courseByStudent.get(s.id) ?? [],
        veAttempts: veByStudent.get(s.id) ?? [],
        certAttempts: certByStudent.get(s.id) ?? [],
        openPct: openPctByStudent.get(s.id),
        progressUpdatedAt: prog?.updated_at ?? null,
      });
      return {
        student_id: s.id,
        name: s.full_name || s.email || 'Unnamed learner',
        email: s.email ?? '',
        account_status: s.status ?? 'active',
        cohort_id: s.cohort_id ?? null,
        cohort_name: cohortLabel(s.cohort_id),
        source,
        plan_name: sub ? (planNameById.get(sub.plan_id) ?? null) : null,
        subscription_status: sub?.status ?? null,
        subscription_ends_at: sub?.current_period_end ?? null,
        // Expiry clears students.cohort_id, so this is what keeps a lapsed subscriber under their plan.
        former_plan_cohort_id: source === 'former' ? (sub?.cohort_id ?? null) : null,
        enrolled_at: enrolledAt,
        ...summary,
        completed_at: summary.status === 'completed' ? (prog?.completed_at ?? summary.last_active_at) : null,
        certificate_issued: !!prog?.cert_id,
      };
    }).filter(l => l.source !== 'former' || l.status !== 'not_started' || progressByStudent.has(l.student_id));

    const seen = new Set<string>();
    const cohorts: PathReportCohort[] = [];
    for (const id of [...pathCohortIds, ...learners.flatMap(l => [l.cohort_id, l.former_plan_cohort_id]).filter(Boolean) as string[]]) {
      if (seen.has(id) || !cohortById.has(id)) continue;
      seen.add(id);
      const source = sourceForCohortKind(cohortById.get(id).cohort_kind);
      cohorts.push({ id, name: cohortLabel(id) ?? 'Cohort', source, plan_name: planNameByCohort.get(id) ?? null });
    }
    cohorts.sort((a, b) => a.name.localeCompare(b.name));

    const report: PathReport = {
      path: { id: path.id, title: path.title, status: path.status, available_to_everyone: path.available_to_everyone === true },
      items,
      cohorts,
      learners,
    };
    return NextResponse.json(report);
  } catch (err) {
    console.error('[learning-paths/report] GET error:', err);
    return NextResponse.json({ error: 'Failed to build the learning path report.' }, { status: 500 });
  }
}