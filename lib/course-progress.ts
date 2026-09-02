/**
 * Progress counting for a course -- the single rule shared by the player, the student cards and the
 * instructor reports. Course twin of lib/ve-completion.ts, and it exists for the same reason: the
 * calculation was duplicated across five surfaces and they disagreed.
 *
 * Two different denominators live in a course and must not be confused:
 *
 *   SCORE     only gradeable slides. Sections, lesson-only slides, downloads blocks and LinkedIn
 *             share slides are all excluded. That is `isScorableSlide` in CourseTaker and `scorable`
 *             in /api/course complete-attempt.
 *   PROGRESS  every slide the student has to move through, which DOES include lesson-only slides and
 *             downloads blocks (they complete by being viewed). That is what lives here.
 *
 * A LinkedIn share slide is the one slide whose participation depends on the student: an OPTIONAL
 * share (anything but linkedInShareRequired === true) they have not claimed leaves the denominator
 * entirely, so skipping it cannot pin a course below 100%. Claim it and it counts, so the choice to
 * share is still visibly credited.
 */

import { linkedInSharePointsFor } from '@/lib/course-schema';

export interface CourseProgressCounts {
  /** Slides that must be completed. Excludes sections, and excludes a skipped optional share. */
  total: number;
  done: number;
  /** Every non-section slide, counted or not -- distinguishes "empty course" from "all skippable". */
  authored: number;
}

/**
 * Keys the player stores in `answers` alongside real answers: `__meta_<id>` (timing, for the time
 * bonus) and `__review_<id>` (AI review snapshots). Counting raw answer keys therefore overstates how
 * much a student has done, which is why every count here iterates SLIDES instead.
 */
export function isInternalAnswerKey(key: string): boolean {
  return key.startsWith('__meta_') || key.startsWith('__review_');
}

/** A slide is answered when it has any stored answer. Share slides store the claimed post URL. */
function isAnswered(question: any, answers: Record<string, any>): boolean {
  return !!(answers ?? {})[question?.id];
}

/**
 * An optional share the student has not claimed -- the only slide that drops out of the denominator.
 * The one place this rule is expressed.
 */
function isSkippedOptionalShare(question: any, answers: Record<string, any>): boolean {
  return !!question?.isLinkedInShare
    && question.linkedInShareRequired !== true
    && !isAnswered(question, answers);
}

/** Whether a slide participates in the progress denominator. */
export function isCountableSlide(question: any, answers: Record<string, any>): boolean {
  if (!question || question.isSection) return false;
  return !isSkippedOptionalShare(question, answers);
}

export function courseProgressCounts(questions: any[], answers: Record<string, any>): CourseProgressCounts {
  let total = 0;
  let done = 0;
  let authored = 0;

  for (const q of questions ?? []) {
    if (!q || q.isSection) continue;
    authored++;
    if (isSkippedOptionalShare(q, answers)) continue;
    total++;
    if (isAnswered(q, answers)) done++;
  }

  return { total, done, authored };
}

/**
 * Display percentage for a course.
 *
 * A course whose only outstanding slide is a skipped optional share reads 100%, matching the fact
 * that nothing is blocking the student. A course with no slides at all reads 0%.
 */
export function courseProgressPct(questions: any[], answers: Record<string, any>): number {
  const counts = courseProgressCounts(questions, answers);
  if (counts.authored === 0) return 0;
  if (counts.total === 0) return 100;   // every slide was skippable, and was skipped
  return Math.round((counts.done / counts.total) * 100);
}

export interface CourseContentCounts {
  /** Teaching slides -- the ones a student reads rather than answers. */
  lessons: number;
  /** Gradeable slides: questions, SQL and Python exercises, reviews. */
  exercises: number;
}

/**
 * What a course contains, for the "what you get" panel on its landing page.
 *
 * The split is the SCORE rule above, read from the other side: a `lessonOnly` slide teaches,
 * anything gradeable is an exercise, and sections, downloads blocks and share slides are neither
 * -- nobody enrols because a course has a downloads block.
 *
 * The exercise rule is isScorableQuestion() in lib/attempt-points.ts, written out again rather than
 * imported so a public landing page does not pull the server XP module into the browser bundle.
 * Change one and change the other.
 */
export function courseContentCounts(questions: any[]): CourseContentCounts {
  let lessons = 0;
  let exercises = 0;
  for (const q of questions ?? []) {
    if (!q || q.isSection) continue;
    if (q.lessonOnly) { lessons++; continue; }
    if (q.isDownloads || q.isLinkedInShare) continue;
    exercises++;
  }
  return { lessons, exercises };
}

/**
 * The XP a course advertises before a student starts, for the "Total XP" line on its landing page.
 *
 * Every gradeable question is worth basePoints; a LinkedIn share slide is worth its own configured
 * bonus instead, and lesson-only/downloads/section slides are worth nothing. Multiplying every
 * non-section slide by basePoints -- as this used to -- counted lessons and downloads that award
 * nothing, and priced a share slide at basePoints rather than its bonus.
 *
 * A deliberate floor, not the ceiling: time and streak bonuses can push the real total higher. What a
 * student actually earns is computed server-side by lib/attempt-points.ts.
 */
export function courseXpOnOffer(questions: any[], pointsSystem: any): number {
  if (!pointsSystem || pointsSystem.enabled === false) return 0;
  const basePoints = Number(pointsSystem.basePoints) || 0;
  let total = 0;
  for (const q of questions ?? []) {
    if (!q || q.isSection || q.lessonOnly || q.isDownloads) continue;
    if (q.isLinkedInShare) {
      total += linkedInSharePointsFor(q);
      continue;
    }
    total += basePoints;
  }
  return Math.max(0, total);
}

/**
 * How many SCORED questions the student answered, for "you answered X of Y".
 *
 * Y is the scorable count, so X must be measured over the same set -- counting `answers` keys instead
 * pulls in `__meta_`/`__review_` entries and a claimed share URL, and can report more answers than
 * there are questions.
 */
export function answeredScorableCount(questions: any[], answers: Record<string, any>): number {
  return (questions ?? []).filter(q =>
    q && !q.lessonOnly && !q.isSection && !q.isDownloads && !q.isLinkedInShare && isAnswered(q, answers),
  ).length;
}
