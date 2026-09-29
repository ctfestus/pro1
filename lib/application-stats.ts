import type { ApplicationStage } from '@/lib/application-forms';

// Insights numbers for one application form, computed from its submitted applications.
// Pure and dependency-free so the Insights view can derive them from data it already loaded.
// Days are the viewer's local calendar days, which is what "today" means to a reviewer.

export interface ApplicationOverviewInput {
  submittedAt: string;
  stageId: string;
}

export interface ApplicationOverview {
  total: number;
  today: number;
  last7Days: number;
  /** One entry per day, oldest first, ending today. `date` is the local day as YYYY-MM-DD. */
  daily: { date: string; count: number }[];
  /** Every configured stage in order, plus applicants whose stage no longer exists. */
  byStage: { id: string; name: string; count: number }[];
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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
  };
}
