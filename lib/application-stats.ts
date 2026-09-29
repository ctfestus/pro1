import type { ApplicationStage, ApplicationStatusEvent } from '@/lib/application-forms';

// Overview numbers for one application form, computed from its submitted applications.
// Pure and dependency-free so the review panel can derive it from data it already loaded.
// Days are the viewer's local calendar days, which is what "today" means to a reviewer.

export interface ApplicationOverviewInput {
  submittedAt: string;
  stageId: string;
  statusHistory?: ApplicationStatusEvent[];
}

export interface ApplicationOverview {
  total: number;
  today: number;
  last7Days: number;
  /** One entry per day, oldest first, ending today. `date` is the local day as YYYY-MM-DD. */
  daily: { date: string; count: number }[];
  /** Every configured stage in order, plus applicants whose stage no longer exists. */
  byStage: { id: string; name: string; count: number }[];
  /** Applications that have moved past the stage they were submitted into. */
  decidedCount: number;
  /** Median time from submission to the first stage change, or null if none moved yet. */
  medianHoursToFirstDecision: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Hours from submission to the first recorded stage change after it. */
function hoursToFirstDecision(item: ApplicationOverviewInput): number | null {
  const submitted = new Date(item.submittedAt).getTime();
  if (!Number.isFinite(submitted)) return null;
  const later = (item.statusHistory ?? [])
    .map(event => new Date(event.occurredAt).getTime())
    .filter(time => Number.isFinite(time) && time > submitted);
  return later.length ? (Math.min(...later) - submitted) / HOUR_MS : null;
}

export function applicationOverview(
  stages: ApplicationStage[],
  submissions: ApplicationOverviewInput[],
  now: Date = new Date(),
  days = 30,
): ApplicationOverview {
  const dailyCounts = new Map<string, number>();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const daily = Array.from({ length: days }, (_, offset) => {
    const date = localDayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset));
    dailyCounts.set(date, 0);
    return date;
  });

  const todayKey = localDayKey(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const stageCounts = new Map<string, number>();
  const decisionHours: number[] = [];
  let today = 0;
  let last7Days = 0;

  for (const item of submissions) {
    const submitted = new Date(item.submittedAt);
    if (!Number.isNaN(submitted.getTime())) {
      const key = localDayKey(submitted);
      if (dailyCounts.has(key)) dailyCounts.set(key, dailyCounts.get(key)! + 1);
      if (key === todayKey) today += 1;
      if (submitted.getTime() >= weekStart && submitted.getTime() <= now.getTime()) last7Days += 1;
    }
    stageCounts.set(item.stageId, (stageCounts.get(item.stageId) ?? 0) + 1);
    const hours = hoursToFirstDecision(item);
    if (hours !== null) decisionHours.push(hours);
  }

  const knownStageIds = new Set(stages.map(stage => stage.id));
  const orphanCount = [...stageCounts].filter(([id]) => !knownStageIds.has(id)).reduce((sum, [, count]) => sum + count, 0);

  return {
    total: submissions.length,
    today,
    last7Days,
    daily: daily.map(date => ({ date, count: dailyCounts.get(date) ?? 0 })),
    byStage: [
      ...stages.map(stage => ({ id: stage.id, name: stage.name, count: stageCounts.get(stage.id) ?? 0 })),
      ...(orphanCount ? [{ id: '', name: 'Other', count: orphanCount }] : []),
    ],
    decidedCount: decisionHours.length,
    medianHoursToFirstDecision: median(decisionHours),
  };
}

/** "Under 1 hour", "5 hours", "3 days". Plain ASCII for the UI. */
export function formatDecisionTime(hours: number | null): string {
  if (hours === null) return 'No decisions yet';
  if (hours < 1) return 'Under 1 hour';
  if (hours < 48) {
    const rounded = Math.round(hours);
    return `${rounded} hour${rounded === 1 ? '' : 's'}`;
  }
  const dayCount = Math.round(hours / 24);
  return `${dayCount} days`;
}
