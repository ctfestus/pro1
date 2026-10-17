// Learning path report: the contract between /api/learning-paths/report and the dashboard
// Report view, plus the pure per-learner summary both sides agree on.
//
// Completion follows the same merge rule as the student's own path view (get-student-paths in
// app/api/learning-paths/route.ts): an item is done when it is in the stored
// learning_path_progress.completed_item_ids OR the attempt tables say so (a passed course, a
// completed VE, a passed certification). The stored row can lag behind real attempts, so neither
// side alone is trustworthy, and an instructor must never see a different number from the learner.

export type PathItemKind = 'course' | 'virtual_experience' | 'certification';
export type PathItemStatus = 'not_started' | 'in_progress' | 'failed' | 'completed';
export type PathLearnerStatus = 'not_started' | 'in_progress' | 'completed';

/**
 * How the learner reaches the path today.
 * - cohort: their bootcamp cohort is assigned to the path
 * - subscriber: their subscription plan covers the path
 * - individual: a legacy per-student cohort is assigned to the path
 * - open: the path is available to everyone and none of the above applies
 * - former: no current access (e.g. an expired subscription) but they have progress on it
 */
export type EnrollmentSource = 'cohort' | 'subscriber' | 'individual' | 'open' | 'former';

export type PathReportItem = { id: string; title: string; kind: PathItemKind };

export type PathReportItemProgress = {
  status: PathItemStatus;
  /** Best score on a finished attempt (courses and certifications). */
  score: number | null;
  /** Share of an unfinished item already done, 0-100. 100 once completed. */
  progress_pct: number;
  last_active_at: string | null;
};

export type PathReportLearner = {
  student_id: string;
  name: string;
  email: string;
  account_status: string;
  cohort_id: string | null;
  cohort_name: string | null;
  source: EnrollmentSource;
  plan_name: string | null;
  subscription_status: string | null;
  subscription_ends_at: string | null;
  /** For a learner with no current access: the cohort of the plan they held, so a plan filter still finds them. */
  former_plan_cohort_id: string | null;
  enrolled_at: string | null;
  status: PathLearnerStatus;
  completed_count: number;
  total_items: number;
  progress_pct: number;
  /**
   * The step the learner is on: the unfinished item they touched most recently (items can be taken
   * out of order), or the first unfinished item in path order if they have not touched any.
   */
  current_item_id: string | null;
  last_active_at: string | null;
  completed_at: string | null;
  certificate_issued: boolean;
  items: Record<string, PathReportItemProgress>;
};

export type PathReportCohort = {
  id: string;
  name: string;
  source: EnrollmentSource;
  plan_name: string | null;
};

export type PathReport = {
  path: { id: string; title: string; status: string; available_to_everyone: boolean };
  items: PathReportItem[];
  cohorts: PathReportCohort[];
  learners: PathReportLearner[];
};

// Attempt shapes as read by the route -- only the columns the summary needs.
export type CourseAttemptRow = { course_id: string; passed: boolean | null; score: number | null; completed_at: string | null; updated_at: string | null };
export type VeAttemptRow = { ve_id: string; completed_at: string | null; updated_at: string | null };
export type CertAttemptRow = { certification_id: string; passed: boolean | null; score: number | null; completed_at: string | null; updated_at: string | null };

function later(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

/** Status of one item for one learner, from all of that learner's attempts on it. */
export function summarizeItem(
  kind: PathItemKind,
  attempts: Array<{ passed?: boolean | null; score?: number | null; completed_at: string | null; updated_at: string | null }>,
  storedComplete: boolean,
  openPct: number | undefined,
): PathReportItemProgress {
  let lastActive: string | null = null;
  let best: number | null = null;
  let done = false;
  let failed = false;
  let open = false;
  for (const a of attempts) {
    lastActive = later(lastActive, a.updated_at ?? a.completed_at);
    if (!a.completed_at) { open = true; continue; }
    if (kind !== 'virtual_experience' && typeof a.score === 'number') best = best === null ? a.score : Math.max(best, a.score);
    // A VE has no pass mark: finishing it is completing it. Courses and certifications need a pass.
    if (kind === 'virtual_experience' || a.passed === true) done = true;
    else failed = true;
  }
  if (done || storedComplete) return { status: 'completed', score: best, progress_pct: 100, last_active_at: lastActive };
  // An active retake outranks an earlier failure, matching the course report.
  if (open) return { status: 'in_progress', score: best, progress_pct: Math.max(0, Math.min(99, openPct ?? 0)), last_active_at: lastActive };
  if (failed) return { status: 'failed', score: best, progress_pct: 0, last_active_at: lastActive };
  return { status: 'not_started', score: null, progress_pct: 0, last_active_at: null };
}

/** Per-learner path summary. `openPct` maps item id to the in-progress % of the learner's open attempt. */
export function summarizeLearnerProgress(args: {
  items: PathReportItem[];
  storedCompletedIds: string[];
  courseAttempts: CourseAttemptRow[];
  veAttempts: VeAttemptRow[];
  certAttempts: CertAttemptRow[];
  openPct?: Map<string, number>;
  progressUpdatedAt?: string | null;
}): Pick<PathReportLearner, 'status' | 'completed_count' | 'total_items' | 'progress_pct' | 'current_item_id' | 'last_active_at' | 'items'> {
  const stored = new Set(args.storedCompletedIds);
  const byItem = new Map<string, any[]>();
  const push = (id: string, row: any) => { const list = byItem.get(id); if (list) list.push(row); else byItem.set(id, [row]); };
  for (const a of args.courseAttempts) push(a.course_id, a);
  for (const a of args.veAttempts) push(a.ve_id, a);
  for (const a of args.certAttempts) push(a.certification_id, a);

  const items: Record<string, PathReportItemProgress> = {};
  let completed = 0;
  let started = false;
  let firstIncomplete: string | null = null;
  let activeIncomplete: string | null = null;
  let activeAt: string | null = null;
  let lastActive: string | null = args.progressUpdatedAt ?? null;
  for (const item of args.items) {
    const p = summarizeItem(item.kind, byItem.get(item.id) ?? [], stored.has(item.id), args.openPct?.get(item.id));
    items[item.id] = p;
    if (p.status === 'completed') completed += 1;
    else {
      if (firstIncomplete === null) firstIncomplete = item.id;
      if (p.last_active_at && (!activeAt || p.last_active_at > activeAt)) { activeIncomplete = item.id; activeAt = p.last_active_at; }
    }
    if (p.status !== 'not_started') started = true;
    lastActive = later(lastActive, p.last_active_at);
  }

  const total = args.items.length;
  const status: PathLearnerStatus = total > 0 && completed === total ? 'completed' : started ? 'in_progress' : 'not_started';
  return {
    status,
    completed_count: completed,
    total_items: total,
    progress_pct: total ? Math.round((completed / total) * 100) : 0,
    current_item_id: activeIncomplete ?? firstIncomplete,
    last_active_at: lastActive,
    items,
  };
}

/** Map a cohort kind (cohorts.cohort_kind) to how its members reach a path assigned to it. */
export function sourceForCohortKind(kind: string | null | undefined): EnrollmentSource {
  if (kind === 'subscription_plan') return 'subscriber';
  if (kind === 'legacy_individual') return 'individual';
  return 'cohort';
}
