import {
  APPLICATION_OTHER_OPTION,
  applicationChoiceSelections,
  isApplicationOtherAnswer,
  isApplicationContentBlock,
  isQuestionVisible,
  type ApplicationAnswer,
  type ApplicationQuestion,
  type ApplicationStage,
} from '@/lib/application-forms';

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

// --- Answers by question (like a form tool's response summary) ---------------------------

export interface FieldOptionCount {
  label: string;
  count: number;
  /** Share of the applicants who answered this question, 0 to 1. */
  share: number;
}

export type ApplicationFieldBreakdown =
  | {
      kind: 'choice' | 'multi' | 'text';
      id: string;
      label: string;
      /** Applicants who answered. */
      answered: number;
      /** Applicants who were shown the question (conditional questions are not shown to everyone). */
      shown: number;
      options: FieldOptionCount[];
      /** Text only: answers outside the most common ones, grouped. */
      otherCount?: number;
    }
  | {
      kind: 'number';
      id: string;
      label: string;
      answered: number;
      shown: number;
      average: number;
      min: number;
      max: number;
    };

const TOP_TEXT_ANSWERS = 8;

function present(value: ApplicationAnswer | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function withShares(counts: Map<string, number>, answered: number): FieldOptionCount[] {
  return [...counts].map(([label, count]) => ({ label, count, share: answered ? count / answered : 0 }));
}

/**
 * One summary per question that can be summarised: choice questions as counts per option,
 * checkboxes per option (applicants may pick several), short text as its most common answers
 * (skipped when every answer is different, e.g. names), and numbers as average and range.
 * Email, phone, long text, dates, files, consent, and content blocks are left out.
 */
export function applicationFieldBreakdowns(
  questions: ApplicationQuestion[],
  submissions: { answers?: Record<string, ApplicationAnswer> }[],
): ApplicationFieldBreakdown[] {
  const result: ApplicationFieldBreakdown[] = [];
  for (const question of questions) {
    if (isApplicationContentBlock(question)) continue;
    const shownTo = submissions.filter(item => isQuestionVisible(question, item.answers ?? {}));
    const values = shownTo.map(item => item.answers?.[question.id]).filter(present);
    const answered = values.length;
    const base = { id: question.id, label: question.label, answered, shown: shownTo.length };

    if (['single_choice', 'dropdown', 'yes_no'].includes(question.type)) {
      const configured = question.type === 'yes_no' ? ['Yes', 'No'] : [...(question.options ?? []).filter(Boolean), ...(question.allowOther ? [APPLICATION_OTHER_OPTION] : [])];
      const counts = new Map<string, number>(configured.map(option => [option, 0]));
      // Answers to options that were later renamed or removed still count, under their own label.
      for (const value of values) {
        const option = isApplicationOtherAnswer(value) ? applicationChoiceSelections(value)[0] : String(value);
        counts.set(option, (counts.get(option) ?? 0) + 1);
      }
      result.push({ ...base, kind: 'choice', options: withShares(counts, answered) });
      continue;
    }

    if (question.type === 'multiple_choice') {
      const counts = new Map<string, number>([...(question.options ?? []).filter(Boolean), ...(question.allowOther ? [APPLICATION_OTHER_OPTION] : [])].map(option => [option, 0]));
      for (const value of values) {
        const selections = isApplicationOtherAnswer(value) ? applicationChoiceSelections(value) : Array.isArray(value) ? value : [String(value)];
        for (const option of new Set(selections)) {
          counts.set(option, (counts.get(option) ?? 0) + 1);
        }
      }
      result.push({ ...base, kind: 'multi', options: withShares(counts, answered) });
      continue;
    }

    if (question.type === 'short_text') {
      // Group case- and spacing-insensitively; show the spelling most applicants used.
      const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
      for (const value of values) {
        const text = String(value).trim().replace(/\s+/g, ' ');
        const key = text.toLowerCase();
        const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
        group.count += 1;
        group.spellings.set(text, (group.spellings.get(text) ?? 0) + 1);
        groups.set(key, group);
      }
      if (![...groups.values()].some(group => group.count > 1)) continue;
      const ranked = [...groups.values()]
        .map(group => ({ label: [...group.spellings].sort((a, b) => b[1] - a[1])[0][0], count: group.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      const top = ranked.slice(0, TOP_TEXT_ANSWERS);
      const otherCount = ranked.slice(TOP_TEXT_ANSWERS).reduce((sum, item) => sum + item.count, 0);
      result.push({
        ...base,
        kind: 'text',
        options: top.map(item => ({ ...item, share: answered ? item.count / answered : 0 })),
        ...(otherCount ? { otherCount } : {}),
      });
      continue;
    }

    if (question.type === 'number') {
      const numbers = values.map(Number).filter(Number.isFinite);
      if (!numbers.length) continue;
      result.push({
        ...base,
        kind: 'number',
        answered: numbers.length,
        average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
        min: Math.min(...numbers),
        max: Math.max(...numbers),
      });
    }
  }
  return result;
}
