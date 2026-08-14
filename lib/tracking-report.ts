// Shared engine behind Student Tracking and the bulk-message segments it feeds.
//
// Both surfaces answer the same question -- "which student is where on which piece of content" --
// and they used to answer it with two separate implementations. They drifted: bulk messaging
// stamped every virtual-experience attempt as `passed: false` and then read a completed attempt
// with passed=false as "failed", so completed VEs were counted under Completed on screen and
// emailed under Failed. guided_project_attempts has no `passed` column at all; a completed VE
// attempt is simply complete. Keeping the scoping and the classification here means the count a
// dashboard shows and the recipients an email reaches cannot disagree again.

import { veProgressPct } from '@/lib/ve-completion';
import { courseProgressPct } from '@/lib/course-progress';
import { fetchAllRows, fetchAllRowsByIds, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';

export const STALL_DAYS = 7;

export type ContentType = 'course' | 'virtual_experience' | 'assignment';
export type RowStatus = 'not_started' | 'in_progress' | 'stalled' | 'completed' | 'failed';

export type TrackedItem = {
  id: string;
  title: string;
  slug?: string | null;
  contentType: ContentType;
  cohortIds: string[];
  status: string;
  deadlineDays?: number | null;
  deadlineDate?: string | null;
  /** Set when an assignment delegates its work to a virtual experience. */
  veFormId?: string | null;
};

export type TrackedStudent = { id: string; email: string; full_name: string | null; cohort_id: string };

/** One student paired with one piece of content. progressPct is filled in separately -- see attachProgress. */
export type StatusRow = {
  studentId: string;
  studentEmail: string;
  studentName: string;
  cohortId: string;
  cohortName: string;
  formId: string;
  formTitle: string;
  contentType: ContentType;
  status: RowStatus;
  progressPct: number;
  lastActive: string | null;
  daysSinceActivity: number | null;
  score: number | null;
  passed: boolean | null;
  deadline: string | null;
  daysUntilDeadline: number | null;
  isAtRisk: boolean;
};

export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Content the caller may report on, with every cohort that can reach it.
 *
 * `ownerScoped` forces the owner-only view even for admins and staff. The tracking table is a
 * read-only report, so admins see all published content there; bulk messaging sends email, so it
 * stays owner-scoped and passes true. The same call decides both, which is what keeps a segment
 * count from promising recipients the send would refuse.
 */
export async function loadTrackedContent(
  supabase: any,
  opts: { userId: string; role: string; typeFilter?: string; ownerScoped?: boolean; publishedOnly?: boolean },
): Promise<TrackedItem[]> {
  const { userId, role, typeFilter = 'all', ownerScoped = false, publishedOnly = false } = opts;
  // Whose content, and which statuses, are independent questions. Tying them together meant asking
  // for the owner's content silently also asked for their drafts: bulk messaging would then count
  // and email students about a course they cannot open, since students cannot reach unpublished
  // content by any route.
  const seesAllContent  = !ownerScoped && (role === 'admin' || role === 'staff');
  const requirePublished = seesAllContent || publishedOnly;

  const coursesQuery = (from: number, to: number) => {
    let query = supabase.from('courses').select('id, title, slug, cohort_ids, deadline_days, status', { count: 'exact' });
    if (requirePublished) query = query.eq('status', 'published');
    if (!seesAllContent)  query = query.eq('user_id', userId);
    return query.order('id').range(from, to);
  };
  const vesQuery = (from: number, to: number) => {
    let query = supabase.from('virtual_experiences').select('id, title, slug, cohort_ids, deadline_days, status', { count: 'exact' });
    if (requirePublished) query = query.eq('status', 'published');
    if (!seesAllContent)  query = query.eq('user_id', userId);
    return query.order('id').range(from, to);
  };
  const assignmentsQuery = (from: number, to: number) => {
    let query = supabase.from('assignments').select('id, title, cohort_ids, deadline_date, type, config, status', { count: 'exact' }).eq('status', 'published');
    if (!seesAllContent) query = query.eq('created_by', userId);
    return query.order('id').range(from, to);
  };
  // A published learning path grants its cohorts access to every course and VE in item_ids without
  // that cohort ever appearing in the item's own cohort_ids -- see the grants in app/api/course and
  // app/api/guided-project-progress. Not owner-scoped: a path can only add cohorts for content the
  // caller already sees, and another instructor's path is a legitimate reason a cohort has access.
  const pathsQuery = (from: number, to: number) => supabase
    .from('learning_paths').select('item_ids, cohort_ids', { count: 'exact' })
    .eq('status', 'published').order('id').range(from, to);

  const wants = (t: ContentType) => typeFilter === 'all' || typeFilter === t;

  const [courses, ves, assignments, paths] = await Promise.all([
    wants('course')             ? fetchAllRows<any>(coursesQuery)     : Promise.resolve([] as any[]),
    wants('virtual_experience') ? fetchAllRows<any>(vesQuery)         : Promise.resolve([] as any[]),
    wants('assignment')         ? fetchAllRows<any>(assignmentsQuery) : Promise.resolve([] as any[]),
    // Paths only ever hold courses, VEs and certifications.
    wants('course') || wants('virtual_experience') ? fetchAllRows<any>(pathsQuery) : Promise.resolve([] as any[]),
  ]);

  const pathCohortsByItem = new Map<string, string[]>();
  for (const path of paths) {
    const pathCohortIds: string[] = Array.isArray(path.cohort_ids) ? path.cohort_ids : [];
    if (!pathCohortIds.length) continue;
    for (const itemId of Array.isArray(path.item_ids) ? path.item_ids : []) {
      const existing = pathCohortsByItem.get(itemId);
      if (existing) existing.push(...pathCohortIds);
      else pathCohortsByItem.set(itemId, [...pathCohortIds]);
    }
  }
  // Both grants require the item itself to be published, so a draft an instructor can see keeps
  // only its directly assigned cohorts.
  const cohortIdsFor = (item: any): string[] => {
    const direct: string[] = Array.isArray(item.cohort_ids) ? item.cohort_ids : [];
    if (item.status !== 'published') return direct;
    const viaPath = pathCohortsByItem.get(item.id);
    return viaPath ? [...new Set([...direct, ...viaPath])] : direct;
  };

  return [
    ...courses.map((c: any): TrackedItem => ({
      id: c.id, title: c.title, slug: c.slug ?? null, contentType: 'course', status: c.status,
      cohortIds: cohortIdsFor(c), deadlineDays: c.deadline_days ?? null,
    })),
    ...ves.map((v: any): TrackedItem => ({
      id: v.id, title: v.title, slug: v.slug ?? null, contentType: 'virtual_experience', status: v.status,
      cohortIds: cohortIdsFor(v), deadlineDays: v.deadline_days ?? null,
    })),
    ...assignments.map((a: any): TrackedItem => ({
      id: a.id, title: a.title, slug: null, contentType: 'assignment', status: a.status,
      cohortIds: Array.isArray(a.cohort_ids) ? a.cohort_ids : [],
      deadlineDate: a.deadline_date ?? null,
      veFormId: a.type === 'virtual_experience' ? (a.config?.ve_form_id ?? null) : null,
    })),
  ];
}

export type GrantedPair = { content_id: string; content_type: 'course' | 'virtual_experience'; cohort_id: string };

/**
 * The (content, cohort) pairs that a published learning path grants and no cohort_assignments row
 * records.
 *
 * Assigning content to a cohort writes both cohort_ids and a cohort_assignments row, so anything
 * driven by that table sees direct assignments correctly. Assigning a learning path writes neither
 * for the items inside it -- access is granted at read time by checking the path. Scheduled jobs
 * that decide who to email from cohort_assignments therefore cannot see a cohort taught only
 * through a path, and silently send them nothing. Fold these pairs in alongside that table.
 *
 * Only published items are returned: an unpublished item inside a published path grants nothing,
 * which is the rule app/api/course and app/api/guided-project-progress both enforce.
 */
export async function loadPathGrantedPairs(supabase: any): Promise<GrantedPair[]> {
  const paths = await fetchAllRows<any>((from, to) => supabase
    .from('learning_paths').select('item_ids, cohort_ids', { count: 'exact' })
    .eq('status', 'published').order('id').range(from, to));

  const cohortsByItem = new Map<string, Set<string>>();
  for (const path of paths) {
    const cohortIds: string[] = Array.isArray(path.cohort_ids) ? path.cohort_ids : [];
    if (!cohortIds.length) continue;
    for (const itemId of Array.isArray(path.item_ids) ? path.item_ids : []) {
      const set = cohortsByItem.get(itemId) ?? new Set<string>();
      for (const cohortId of cohortIds) set.add(cohortId);
      cohortsByItem.set(itemId, set);
    }
  }
  const itemIds = [...cohortsByItem.keys()];
  if (!itemIds.length) return [];

  // A path may also hold certifications, which no scheduled job tracks; they simply do not match
  // either lookup and drop out here.
  const [courses, ves] = await Promise.all([
    fetchAllRowsByIds<any>(itemIds, (idChunk, from, to) => supabase
      .from('courses').select('id', { count: 'exact' }).in('id', idChunk).eq('status', 'published').order('id').range(from, to)),
    fetchAllRowsByIds<any>(itemIds, (idChunk, from, to) => supabase
      .from('virtual_experiences').select('id', { count: 'exact' }).in('id', idChunk).eq('status', 'published').order('id').range(from, to)),
  ]);

  const pairs: GrantedPair[] = [];
  const emit = (id: string, contentType: GrantedPair['content_type']) => {
    for (const cohortId of cohortsByItem.get(id) ?? []) {
      pairs.push({ content_id: id, content_type: contentType, cohort_id: cohortId });
    }
  };
  for (const c of courses) emit(c.id, 'course');
  for (const v of ves)     emit(v.id, 'virtual_experience');
  return pairs;
}

export async function loadCohortNames(supabase: any, cohortIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!cohortIds.length) return [];
  const rows = await fetchAllRowsByIds<{ id: string; name: string }>(cohortIds, (idChunk, from, to) => supabase
    .from('cohorts').select('id, name', { count: 'exact' }).in('id', idChunk).order('id').range(from, to));
  return rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function loadStudents(supabase: any, cohortIds: string[]): Promise<TrackedStudent[]> {
  if (!cohortIds.length) return [];
  return fetchAllRowsByIds<TrackedStudent>(cohortIds, (idChunk, from, to) => supabase
    .from('students').select('id, email, full_name, cohort_id', { count: 'exact' })
    .in('cohort_id', idChunk).eq('role', 'student').order('id').range(from, to));
}

/**
 * Build one row per (student, content) pairing, with status but without progress percentages.
 *
 * The heavy jsonb -- course answers, VE progress, course questions, VE modules -- is deliberately
 * left out: it is only needed to put a number on a part-finished row, and callers that page their
 * output fetch it for the rows they are about to show via attachProgress. Everything status
 * classification needs is a timestamp, a score or a submission state.
 */
export async function buildStatusRows(
  supabase: any,
  opts: { items: TrackedItem[]; students: TrackedStudent[]; cohortNames: Map<string, string>; activeCohortIds: string[] },
): Promise<StatusRow[]> {
  const { items, students, cohortNames, activeCohortIds } = opts;
  if (!items.length || !students.length) return [];

  const courseIds  = items.filter(i => i.contentType === 'course').map(i => i.id);
  const veIds      = items.filter(i => i.contentType === 'virtual_experience').map(i => i.id);
  const veFormIds  = items.map(i => i.veFormId).filter(Boolean) as string[];
  // guided_project_attempts covers standalone VEs and the VEs behind VE-type assignments alike.
  const gpVeIds    = [...new Set([...veIds, ...veFormIds])];
  // A VE-type assignment is complete only once submitted, so it needs its submission row too --
  // the VE attempt alone (completable through the standalone or learning-path route) is not one.
  const submissionIds = items.filter(i => i.contentType === 'assignment').map(i => i.id);
  const allItemIds = items.map(i => i.id);

  // Every query is scoped to both dimensions -- the students in view and the content in view.
  // Filtering on content alone pulled in the attempts of every student on the platform, so a
  // single-cohort view paid for every other cohort's history before discarding it.
  const studentIds = students.map(s => s.id);

  const [courseAttempts, gpAttempts, submissions, cohortAssignments] = await Promise.all([
    fetchAllRowsByIdPairs<any>(studentIds, courseIds, (studentChunk, contentChunk, from, to) => supabase
      .from('course_attempts')
      .select('student_id, course_id, completed_at, updated_at, score, passed', { count: 'exact' })
      .in('student_id', studentChunk).in('course_id', contentChunk).order('id').range(from, to)),
    fetchAllRowsByIdPairs<any>(studentIds, gpVeIds, (studentChunk, contentChunk, from, to) => supabase
      .from('guided_project_attempts')
      .select('student_id, ve_id, completed_at, updated_at', { count: 'exact' })
      .in('student_id', studentChunk).in('ve_id', contentChunk).order('id').range(from, to)),
    fetchAllRowsByIdPairs<any>(studentIds, submissionIds, (studentChunk, contentChunk, from, to) => supabase
      .from('assignment_submissions')
      .select('student_id, assignment_id, status, score, updated_at, submitted_at, graded_at', { count: 'exact' })
      .in('student_id', studentChunk).in('assignment_id', contentChunk).order('id').range(from, to)),
    fetchAllRowsByIdPairs<any>(allItemIds, activeCohortIds, (contentChunk, cohortChunk, from, to) => supabase
      .from('cohort_assignments')
      .select('content_id, cohort_id, assigned_at', { count: 'exact' })
      .in('content_id', contentChunk).in('cohort_id', cohortChunk).order('id').range(from, to)),
  ]);

  const cohortAssignmentMap = new Map<string, string>();
  for (const ca of cohortAssignments) cohortAssignmentMap.set(`${ca.content_id}|${ca.cohort_id}`, ca.assigned_at);

  const courseAttemptMap = new Map<string, any>();
  for (const a of courseAttempts) {
    const key = `${a.student_id}|${a.course_id}`;
    const existing = courseAttemptMap.get(key);
    if (!existing) { courseAttemptMap.set(key, a); continue; }
    // Passed+completed always wins over in-progress.
    if (a.passed && a.completed_at && !existing.completed_at) { courseAttemptMap.set(key, a); continue; }
    if (existing.passed && existing.completed_at && !a.completed_at) continue;
    // A current retake should beat an older completed-but-failed attempt.
    if (!a.completed_at && existing.completed_at && !existing.passed) { courseAttemptMap.set(key, a); continue; }
    if (a.completed_at && !a.passed && !existing.completed_at) continue;
    // Among completed, prefer higher score
    if (a.completed_at && existing.completed_at && (a.score ?? 0) > (existing.score ?? 0)) { courseAttemptMap.set(key, a); continue; }
    // Among in-progress, prefer most recently updated
    if (!a.completed_at && !existing.completed_at && new Date(a.updated_at) > new Date(existing.updated_at)) courseAttemptMap.set(key, a);
  }

  const gpAttemptMap = new Map<string, any>();
  for (const a of gpAttempts) gpAttemptMap.set(`${a.student_id}|${a.ve_id}`, a);

  const submissionMap = new Map<string, any>();
  for (const s of submissions) submissionMap.set(`${s.student_id}|${s.assignment_id}`, s);

  const studentsByCohort = new Map<string, TrackedStudent[]>();
  for (const student of students) {
    const list = studentsByCohort.get(student.cohort_id);
    if (list) list.push(student);
    else studentsByCohort.set(student.cohort_id, [student]);
  }

  const rows: StatusRow[] = [];

  const activeCohortSet = new Set(activeCohortIds);

  for (const item of items) {
    const itemCohortIds = item.cohortIds.filter(id => activeCohortSet.has(id));
    if (!itemCohortIds.length) continue;

    const isVE           = item.contentType === 'virtual_experience';
    const isAssignment   = item.contentType === 'assignment';
    const isVeAssignment = isAssignment && !!item.veFormId;

    for (const student of itemCohortIds.flatMap(cid => studentsByCohort.get(cid) ?? [])) {
      const key = `${student.id}|${item.id}`;

      let status: RowStatus = 'not_started';
      let lastActive: string | null = null;
      let score: number | null = null;
      let passed: boolean | null = null;

      if (isVeAssignment) {
        const sub = submissionMap.get(key);
        const attempt = gpAttemptMap.get(`${student.id}|${item.veFormId}`);
        if (sub && sub.status !== 'draft') {
          status = 'completed';
          lastActive = sub.graded_at ?? sub.submitted_at ?? sub.updated_at ?? null;
          score = sub.score ?? null;
        } else if (attempt) {
          lastActive = attempt.updated_at ?? null;
          const days = daysSince(lastActive);
          status = days !== null && days >= STALL_DAYS ? 'stalled' : 'in_progress';
        }
      } else if (isAssignment) {
        const sub = submissionMap.get(key);
        if (sub && sub.status === 'draft') {
          lastActive = sub.updated_at ?? null;
          const days = daysSince(lastActive);
          status = days !== null && days >= STALL_DAYS ? 'stalled' : 'in_progress';
        } else if (sub) {
          status = 'completed';
          lastActive = sub.graded_at ?? sub.submitted_at ?? sub.updated_at ?? null;
          score = sub.score ?? null;
        }
      } else {
        const attempt = isVE ? gpAttemptMap.get(key) : courseAttemptMap.get(key);
        if (attempt?.completed_at) {
          // Only courses carry a pass mark. guided_project_attempts has no `passed` column, so a
          // completed VE attempt is complete -- never failed.
          status = attempt.passed === false ? 'failed' : 'completed';
          lastActive = attempt.updated_at ?? attempt.completed_at;
          score  = attempt.score ?? null;
          passed = attempt.passed ?? null;
        } else if (attempt) {
          lastActive = attempt.updated_at ?? null;
          const days = daysSince(lastActive);
          status = days !== null && days >= STALL_DAYS ? 'stalled' : 'in_progress';
        }
      }

      let deadline: string | null = null;
      let daysUntilDeadline: number | null = null;
      if (isAssignment && item.deadlineDate) {
        const dl = new Date(item.deadlineDate);
        deadline = dl.toISOString();
        daysUntilDeadline = Math.ceil((dl.getTime() - Date.now()) / 86400000);
      } else if (!isAssignment) {
        const assignedAt = cohortAssignmentMap.get(`${item.id}|${student.cohort_id}`);
        if (assignedAt && item.deadlineDays) {
          const dl = new Date(new Date(assignedAt).getTime() + Number(item.deadlineDays) * 86400000);
          deadline = dl.toISOString();
          daysUntilDeadline = Math.ceil((dl.getTime() - Date.now()) / 86400000);
        }
      }

      rows.push({
        studentId:         student.id,
        studentEmail:      student.email,
        studentName:       student.full_name ?? '',
        cohortId:          student.cohort_id,
        cohortName:        cohortNames.get(student.cohort_id) ?? '',
        formId:            item.id,
        formTitle:         item.title,
        contentType:       item.contentType,
        status,
        // Completed and untouched rows are already known; the rest is filled by attachProgress.
        progressPct:       status === 'completed' || status === 'failed' ? 100 : 0,
        lastActive,
        daysSinceActivity: daysSince(lastActive),
        score,
        passed,
        deadline,
        daysUntilDeadline,
        isAtRisk:          status === 'failed' || (status !== 'completed' && daysUntilDeadline !== null && daysUntilDeadline <= 3),
      });
    }
  }

  return rows;
}

/**
 * Put a percentage on the part-finished rows in `rows`, in place.
 *
 * Call this with the page about to be rendered, not the whole report. It is the only step that
 * touches the large jsonb columns (course questions and answers, VE modules and progress), so
 * scoping it to a page is what keeps a page request off the whole tenant's content.
 */
export async function attachProgress(supabase: any, rows: StatusRow[], items: TrackedItem[]): Promise<void> {
  const pending = rows.filter(r => r.status === 'in_progress' || r.status === 'stalled');
  if (!pending.length) return;

  const itemById = new Map(items.map(i => [i.id, i]));
  const studentIds = [...new Set(pending.map(r => r.studentId))];

  // A part-finished assignment has no measurable progress, only a submitted draft.
  for (const row of pending) if (row.contentType === 'assignment' && !itemById.get(row.formId)?.veFormId) row.progressPct = 50;

  const courseIds = [...new Set(pending.filter(r => r.contentType === 'course').map(r => r.formId))];
  const veTargets = new Map<string, string>(); // row's formId -> the VE id holding the modules
  for (const row of pending) {
    const item = itemById.get(row.formId);
    if (!item) continue;
    if (item.contentType === 'virtual_experience') veTargets.set(row.formId, item.id);
    else if (item.veFormId) veTargets.set(row.formId, item.veFormId);
  }
  const veIds = [...new Set(veTargets.values())];

  const [courseDefs, veDefs, courseAttempts, gpAttempts] = await Promise.all([
    fetchAllRowsByIds<any>(courseIds, (idChunk, from, to) => supabase
      .from('courses').select('id, questions', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(veIds, (idChunk, from, to) => supabase
      .from('virtual_experiences').select('id, modules', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    // Two id lists in one URL, so both are chunked -- see fetchAllRowsByIdPairs.
    fetchAllRowsByIdPairs<any>(studentIds, courseIds, (students, courses, from, to) => supabase
      .from('course_attempts')
      .select('student_id, course_id, answers, completed_at, updated_at', { count: 'exact' })
      .in('student_id', students).in('course_id', courses).order('id').range(from, to)),
    fetchAllRowsByIdPairs<any>(studentIds, veIds, (students, ves, from, to) => supabase
      .from('guided_project_attempts')
      .select('student_id, ve_id, progress', { count: 'exact' })
      .in('student_id', students).in('ve_id', ves).order('id').range(from, to)),
  ]);

  const questionsById = new Map(courseDefs.map((c: any) => [c.id, c.questions]));
  const modulesById   = new Map(veDefs.map((v: any) => [v.id, v.modules]));

  // Mirror buildStatusRows: an in-progress row is the open attempt, so prefer the unfinished one.
  const answersByKey = new Map<string, any>();
  for (const a of courseAttempts) {
    const key = `${a.student_id}|${a.course_id}`;
    const existing = answersByKey.get(key);
    if (!existing || (!a.completed_at && existing.completed_at)) { answersByKey.set(key, a); continue; }
    if (!a.completed_at && !existing.completed_at && new Date(a.updated_at) > new Date(existing.updated_at)) answersByKey.set(key, a);
  }
  const progressByKey = new Map<string, any>();
  for (const a of gpAttempts) progressByKey.set(`${a.student_id}|${a.ve_id}`, a.progress ?? {});

  for (const row of pending) {
    if (row.contentType === 'course') {
      const attempt = answersByKey.get(`${row.studentId}|${row.formId}`);
      row.progressPct = courseProgressPct((questionsById.get(row.formId) as any[]) ?? [], attempt?.answers ?? {});
      continue;
    }
    const veId = veTargets.get(row.formId);
    if (!veId) continue;
    row.progressPct = veProgressPct(modulesById.get(veId) ?? [], progressByKey.get(`${row.studentId}|${veId}`) ?? {});
  }
}
