// The student "My Program" view: contract between /api/student/program and the section, plus the
// pure timeline logic that turns a cohort's content into weeks, statuses and pace.
//
// The route returns facts (what the student has done, when each item is due). Everything that
// depends on "today" -- overdue, the current week, pace -- is decided here from the student's own
// local date, so a deadline flips to Overdue at the student's midnight rather than the server's.
//
// Weeks are counted from the cohort start date: days 0-6 are Week 1, days 7-13 Week 2, and so on.
// An item with a due date lands in the week it is due. An item with no due date starts in the week
// it was assigned (a path's courses use the path's date), moves forward with the current week while
// unfinished, and settles in the week it was completed. Items with neither date go to `anytime`.

export type ProgramItemType = 'course' | 'virtual_experience' | 'assignment' | 'certification' | 'event';

/** What the student has done, independent of the date. */
export type ProgramBaseStatus =
  | 'done' | 'awaiting_grade' | 'failed' | 'in_progress' | 'not_started'
  | 'attended' | 'not_attended';

export type ProgramItem = {
  id: string;
  title: string;
  type: ProgramItemType;
  href: string;
  baseStatus: ProgramBaseStatus;
  /** 0-100, only meaningful while in progress. */
  progressPct: number;
  /**
   * A calendar date (YYYY-MM-DD), an exact deadline (ISO timestamp, resolved to the viewer's local
   * date), or null when the item has no deadline. buildProgramTimeline normalizes it to a date.
   */
  dueDate: string | null;
  /** Live sessions that repeat are listed once, at their first date. */
  recurring?: boolean;
  /** Last date of a repeating live session; it is only missed once that date has passed. */
  lastDate?: string | null;
  /** Set by the dashboard when access is paused (unpaid balance); shown but not offered as next. */
  locked?: boolean;
  /**
   * When the item reached the cohort (ISO). For a course or VE taught through a learning path, the
   * path's date. Places work with no deadline in the week it was handed out.
   */
  assignedAt?: string | null;
  /** When the student finished it (ISO), for done and submitted work. */
  completedAt?: string | null;
};

export type ProgramCohort = {
  id: string;
  name: string;
  startDate: string | null;
  /** End of the cohort, including the catch-up period after classes. */
  endDate: string | null;
  /** Last day of classes (migration 223). Null = classes run to endDate, no catch-up period. */
  classesEndDate?: string | null;
};
export type ProgramGroupMember = { id: string; name: string; avatarUrl: string | null; isLeader: boolean; isYou: boolean };
export type ProgramGroup = { id: string; name: string; description: string | null; members: ProgramGroupMember[] };

export type ProgramPayload = {
  cohort: ProgramCohort | null;
  items: ProgramItem[];
  group: ProgramGroup | null;
};

/** What the student sees on an item once the date is taken into account. */
export type ProgramStatus =
  | 'done' | 'awaiting' | 'progress' | 'overdue' | 'failed' | 'todo'
  | 'attended' | 'missed' | 'upcoming';

export type TimelineItem = ProgramItem & {
  status: ProgramStatus;
  week: number | null;
  /** For unfinished work with no deadline: the week it was assigned, when it has since moved on. */
  carriedFrom: number | null;
};

export type ProgramWeek = {
  week: number;
  startDate: string;
  items: TimelineItem[];
  required: number;
  completed: number;
  hasOverdue: boolean;
};

/**
 * `catch_up` = classes are over but the cohort's catch-up period is still running. Called catch-up,
 * not grace, because "grace period" already means late-payment grace on the student page.
 */
export type ProgramPhase = 'before' | 'during' | 'catch_up' | 'after' | 'undated';

export type ProgramTimeline = {
  weeks: ProgramWeek[];
  anytime: TimelineItem[];
  phase: ProgramPhase;
  /**
   * 1-based; null when the program has no dates or has not started. Without an end date the program
   * can run past its last dated week, so this may exceed weeks.length.
   */
  currentWeek: number | null;
  /** True when classes have a known last day, so "of N weeks" is meaningful. */
  hasEndDate: boolean;
  /** The last day of classes actually used: the cohort's, or null when unset or out of range. */
  classesEndDate: string | null;
  /** The cohort end date when it extends past classes (a catch-up period), else null. */
  catchUpEndDate: string | null;
  required: number;
  completed: number;
  pct: number;
  /** Counts over required items only. */
  statusCounts: Record<ProgramStatus, number>;
  /** Required items that were due before today and are not complete. */
  behind: number;
  /** Share of class time already passed, or null when classes have no known last day. */
  timePct: number | null;
  /** Days of classes left while classes run; days of catch-up left during the catch-up period. */
  daysLeft: number | null;
  daysUntilStart: number | null;
  upNext: TimelineItem | null;
};

const DAY_MS = 86_400_000;
const MAX_WEEKS = 52;

/** Live sessions are shown on the journey but are not work to complete. */
export const countsTowardCompletion = (item: Pick<ProgramItem, 'type'>) => item.type !== 'event';

/** Submitted work counts as complete while it waits for a grade. */
export const isCompleteStatus = (status: ProgramStatus) => status === 'done' || status === 'awaiting';

/** Whole days since the epoch for a YYYY-MM-DD string, read as a calendar date. */
export function dayIndex(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dateFromDayIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/** The viewer's own calendar date as YYYY-MM-DD. */
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A due value as the viewer's calendar date: timestamps resolve in local time, dates pass through. */
export function dueDateKey(due: string | null | undefined): string | null {
  if (!due) return null;
  return due.length > 10 ? localDateKey(new Date(due)) : due;
}

export function displayStatus(item: ProgramItem, today: string): ProgramStatus {
  const due = dueDateKey(item.dueDate);
  const pastDue = !!due && dayIndex(due) < dayIndex(today);
  if (item.type === 'event') {
    if (item.baseStatus === 'attended') return 'attended';
    // A repeating session keeps happening after its first date; with no end date it never lapses.
    const last = item.recurring ? (item.lastDate ?? null) : due;
    return last && dayIndex(last) < dayIndex(today) ? 'missed' : 'upcoming';
  }
  switch (item.baseStatus) {
    case 'done': return 'done';
    case 'awaiting_grade': return 'awaiting';
    case 'failed': return 'failed';
    case 'in_progress': return pastDue ? 'overdue' : 'progress';
    default: return pastDue ? 'overdue' : 'todo';
  }
}

const emptyCounts = (): Record<ProgramStatus, number> => ({
  done: 0, awaiting: 0, progress: 0, overdue: 0, failed: 0, todo: 0, attended: 0, missed: 0, upcoming: 0,
});

const byDueThenTitle = (a: TimelineItem, b: TimelineItem) => {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.title.localeCompare(b.title);
};

export function buildProgramTimeline(payload: ProgramPayload, today: string): ProgramTimeline {
  const todayIdx = dayIndex(today);
  const items: TimelineItem[] = payload.items.map(item => ({
    ...item, dueDate: dueDateKey(item.dueDate), status: displayStatus(item, today), week: null, carriedFrom: null,
  }));

  // The day each item is placed by before "today" is considered: its deadline, else (for work with
  // no deadline) the day it was finished or, failing that, assigned.
  const anchorKey = (i: TimelineItem) => i.dueDate
    ?? (isCompleteStatus(i.status) ? dueDateKey(i.completedAt) ?? dueDateKey(i.assignedAt) : dueDateKey(i.assignedAt));
  const dueIdxs = items.map(anchorKey).filter((k): k is string => !!k).map(dayIndex);
  // Without a start date the earliest deadline or assigned date anchors Week 1, so dated content still
  // forms a journey. Completion dates are left out: work finished long before (open access, an
  // earlier cohort) would otherwise drag Week 1 back months.
  const startCandidates = items
    .map(i => i.dueDate ?? dueDateKey(i.assignedAt))
    .filter((k): k is string => !!k).map(dayIndex);
  const startIdx = payload.cohort?.startDate
    ? dayIndex(payload.cohort.startDate)
    : startCandidates.length ? Math.min(...startCandidates) : null;
  const endIdx = payload.cohort?.endDate ? dayIndex(payload.cohort.endDate) : null;
  // Teaching runs to the classes end date when one is set; the rest of the cohort is catch-up. Only
  // the forms validate it (the payment panel can move the cohort dates around it), so a date
  // outside the cohort is ignored rather than trusted.
  const rawClassesEnd = payload.cohort?.classesEndDate ? dayIndex(payload.cohort.classesEndDate) : null;
  const classesEndValid = rawClassesEnd !== null
    && (startIdx === null || rawClassesEnd >= startIdx)
    && (endIdx === null || rawClassesEnd <= endIdx);
  const classesEndIdx = classesEndValid ? rawClassesEnd : endIdx;
  const hasCatchUp = classesEndIdx !== null && endIdx !== null && classesEndIdx < endIdx;

  const weeks: ProgramWeek[] = [];
  let phase: ProgramPhase = 'undated';
  let currentWeek: number | null = null;

  if (startIdx !== null) {
    // Without a last day of classes the journey runs to the latest dated item -- and to today while
    // deadline-free work is still open, so it can be carried into the current week.
    const carriesToToday = classesEndIdx === null
      && items.some(i => !i.dueDate && i.type !== 'event' && !isCompleteStatus(i.status) && anchorKey(i));
    const lastIdx = Math.max(
      startIdx,
      classesEndIdx ?? Math.max(dueIdxs.length ? Math.max(...dueIdxs) : startIdx, carriesToToday ? todayIdx : startIdx),
    );
    const totalWeeks = Math.min(MAX_WEEKS, Math.floor((lastIdx - startIdx) / 7) + 1);
    // Deadlines before the start or after classes end (including any set in the catch-up period) are
    // pulled into the first or last week, so nothing silently drops off the journey.
    const weekOf = (idx: number) => Math.min(totalWeeks, Math.max(1, Math.floor((idx - startIdx) / 7) + 1));

    if (todayIdx < startIdx) phase = 'before';
    // The cohort is over after its end date, or after classes when it has no separate end date.
    else if ((endIdx ?? classesEndIdx) !== null && todayIdx > (endIdx ?? classesEndIdx)!) phase = 'after';
    else if (hasCatchUp && todayIdx > classesEndIdx!) phase = 'catch_up';
    else phase = 'during';
    // With a known last day of classes the journey covers all of them, so clamp. Without one,
    // report the real calendar week even past the last dated item rather than freezing on it.
    currentWeek = phase === 'before' ? null
      : classesEndIdx !== null ? weekOf(todayIdx)
      : Math.floor((todayIdx - startIdx) / 7) + 1;

    for (let w = 1; w <= totalWeeks; w++) {
      weeks.push({ week: w, startDate: dateFromDayIndex(startIdx + (w - 1) * 7), items: [], required: 0, completed: 0, hasOverdue: false });
    }
    // The week unfinished, deadline-free work has reached: this week, or the last one once over.
    const carryWeek = phase === 'before' ? null : weekOf(todayIdx);
    for (const item of items) {
      const anchor = anchorKey(item);
      if (!anchor) continue;
      const anchorWeek = weekOf(dayIndex(anchor));
      item.week = anchorWeek;
      // Work with no deadline that is still open moves forward with the current week until done.
      const carries = !item.dueDate && item.type !== 'event' && !isCompleteStatus(item.status);
      if (carries && carryWeek !== null && carryWeek > anchorWeek) {
        item.week = carryWeek;
        item.carriedFrom = anchorWeek;
      }
      weeks[item.week - 1].items.push(item);
    }
    for (const week of weeks) {
      week.items.sort(byDueThenTitle);
      const required = week.items.filter(countsTowardCompletion);
      week.required = required.length;
      week.completed = required.filter(i => isCompleteStatus(i.status)).length;
      week.hasOverdue = week.items.some(i => i.status === 'overdue');
    }
  }

  const anytime = items.filter(i => i.week === null).sort(byDueThenTitle);
  const required = items.filter(countsTowardCompletion);
  const completed = required.filter(i => isCompleteStatus(i.status)).length;
  const statusCounts = emptyCounts();
  for (const item of required) statusCounts[item.status] += 1;

  const behind = required.filter(i => i.dueDate && dayIndex(i.dueDate) < todayIdx && !isCompleteStatus(i.status)).length;

  let timePct: number | null = null;
  let daysLeft: number | null = null;
  if (startIdx !== null && classesEndIdx !== null && classesEndIdx >= startIdx) {
    const span = classesEndIdx - startIdx + 1;
    timePct = Math.round(Math.min(1, Math.max(0, (todayIdx - startIdx + 1) / span)) * 100);
    daysLeft = Math.max(0, (phase === 'catch_up' ? endIdx! : classesEndIdx) - todayIdx);
  }
  const daysUntilStart = startIdx !== null && todayIdx < startIdx ? startIdx - todayIdx : null;

  // Most urgent first: overdue, then started work, then the next thing due, then anything left.
  // Locked items cannot be opened, so they are never offered as the next step.
  const open = required.filter(i => !i.locked && !isCompleteStatus(i.status));
  const pick = (status: ProgramStatus) => open.filter(i => i.status === status).sort(byDueThenTitle)[0];
  const upNext = pick('overdue') ?? pick('progress') ?? pick('todo') ?? pick('failed') ?? null;

  return {
    weeks, anytime, phase, currentWeek, hasEndDate: classesEndIdx !== null,
    classesEndDate: classesEndValid ? payload.cohort!.classesEndDate! : null,
    catchUpEndDate: hasCatchUp ? payload.cohort!.endDate : null,
    required: required.length,
    completed,
    pct: required.length ? Math.round((completed / required.length) * 100) : 0,
    statusCounts, behind, timePct, daysLeft, daysUntilStart, upNext,
  };
}
