// Pass/fail gating for the AI review players.
//
// The AI returns two independent things: an overall quality score out of 100, and -- when the
// instructor supplied a rubric -- a pass/fail grade per criterion. Gating on the quality score
// alone grades the wrong question: it judges how good the formulas that ARE present are, so a
// workbook that ignored every rubric criterion (hardcoded totals left in place, required cells
// never filled) still scores highly and clears the gate. Where a rubric exists it is the
// instructor's statement of what the task actually required, so it decides the gate and the
// quality score stays as commentary.
//
// One contract governs how a model response becomes a grade, and `collectRubricGrades` is the
// only place it is applied:
//
//   - every criterion has a stable ordinal id, its 1-based position in the instructor's list
//   - a grade is counted only if it names a known id and carries a boolean verdict
//   - at most one grade per id; a second grade for the same id is ignored, never reassigned
//   - unknown ids are ignored -- an invented criterion cannot stand in for a real one
//   - every id with no valid grade is marked failed
//
// The rule behind all of it: an ungraded criterion counts against the submission. Anything looser
// lets an unreliable response quietly retire whichever criteria it left out, which is the whole
// failure this gate exists to prevent. Criterion text is never used to identify a grade -- the
// text in the returned report always comes from the instructor's list, not the model's echo.

export interface RubricGradeLike {
  passed: boolean;
}

export interface RubricGrade {
  criterion: string;
  passed: boolean;
  comment: string;
}

export interface GatedReviewResult {
  overallScore: number;
  rubricGrades?: RubricGradeLike[];
  // Sent by the review routes so every consumer gates on the same number, and set whenever a
  // rubric was submitted -- 0 included. Older saved reports predate it, hence the recompute below.
  rubricScore?: number | null;
}

export interface ReviewGate {
  score: number;
  fromRubric: boolean;
}

export const UNGRADED_COMMENT =
  'The AI reviewer did not grade this criterion, so it counts as not met.';

export interface GradedRubric {
  /** One entry per criterion, in the instructor's order. Ungraded criteria are explicit failures. */
  grades: RubricGrade[];
  /** How many criteria came back with a valid verdict. */
  covered: number;
  /** How many did not, and therefore count as not met. */
  ungraded: number;
}

/** The 1-based ordinal the model is asked to return for a criterion. */
export function rubricCriterionId(index: number): number {
  return index + 1;
}

function idOf(entry: any, criteriaCount: number): number | null {
  const raw = entry?.id;
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(id) || id < 1 || id > criteriaCount) return null;
  return id;
}

/**
 * Turn one or more model responses into one grade per criterion, under the contract above.
 *
 * Passing several responses merges them: each id is filled by the earliest response that graded
 * it, so a retry contributes the criteria the first attempt skipped without overwriting any
 * verdict already given. That is the same first-valid-verdict-wins rule that settles duplicates
 * inside a single response, applied across responses, which makes the outcome independent of how
 * many attempts it took.
 */
export function collectRubricGrades(criteria: readonly string[], ...responses: unknown[]): GradedRubric {
  const claimed = new Map<number, RubricGrade>();

  for (const raw of responses) {
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const id = idOf(entry, criteria.length);
      if (id === null) continue;
      if (typeof entry?.passed !== 'boolean') continue;
      // First valid verdict for an id wins. A later one is a duplicate, not a spare grade to
      // hand to some criterion that went ungraded.
      if (claimed.has(id)) continue;
      claimed.set(id, {
        criterion: criteria[id - 1],
        passed: entry.passed,
        comment: typeof entry.comment === 'string' ? entry.comment : '',
      });
    }
  }

  const grades = criteria.map((criterion, i) => claimed.get(rubricCriterionId(i)) ?? {
    criterion,
    passed: false,
    comment: UNGRADED_COMMENT,
  });
  return { grades, covered: claimed.size, ungraded: criteria.length - claimed.size };
}

/**
 * Share of the instructor's criteria the submission met, 0-100.
 *
 * `criteriaCount` is how many criteria were sent for grading. Ungraded criteria count as not met,
 * so the denominator is the larger of the two counts. Returns null only when there was no rubric
 * at all, which is the one case where the quality score is the right thing to gate on.
 */
export function rubricPassRate(
  grades: readonly RubricGradeLike[] | undefined | null,
  criteriaCount = 0,
): number | null {
  const total = Math.max(criteriaCount, grades?.length ?? 0);
  if (total <= 0) return null;
  const passed = (grades ?? []).filter(g => g?.passed).length;
  return Math.round((Math.min(passed, total) / total) * 1000) / 10;
}

export function reviewGate(result: GatedReviewResult, criteriaCount = 0): ReviewGate {
  // The route computed this with the criteria list in hand, so it wins over any recount here --
  // an instructor who edits the rubric after an attempt must not retroactively re-grade it.
  if (typeof result.rubricScore === 'number') return { score: result.rubricScore, fromRubric: true };
  const rate = rubricPassRate(result.rubricGrades, criteriaCount);
  if (rate !== null) return { score: rate, fromRubric: true };
  return { score: result.overallScore, fromRubric: false };
}

export function reviewPassed(result: GatedReviewResult, minScore?: number, criteriaCount = 0): boolean {
  if (!minScore) return true;
  return reviewGate(result, criteriaCount).score >= minScore;
}
