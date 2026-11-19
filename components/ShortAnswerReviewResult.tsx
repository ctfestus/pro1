'use client';

// The AI review of a short written answer in a virtual experience, shown on the plain step, the
// email-style step and inside an assignment. With criteria it is the rubric report; without, the
// same result card followed by what worked and what to change.

import { ArrowRight, Check } from 'lucide-react';
import RubricReviewReport, { ReviewResultCard, reviewTheme } from '@/components/RubricReviewReport';
import type { RubricGrade } from '@/lib/review-gate';

// Mirrors PASS_MARK in app/api/ve-answer-review/route.ts.
const PASS_MARK = 60;

export interface ShortAnswerResult {
  passed: boolean;
  score: number;
  feedback: string;
  strength?: string;
  improvement?: string;
  rubricGrades?: RubricGrade[];
}

/** What a step holds while showing a review: the result, or a review that never ran. */
export type ShortAnswerFeedback = ShortAnswerResult & { errored?: boolean; upgradeUrl?: string };

/** The result as the review route returned it. */
export function shortAnswerResultOf(json: any): ShortAnswerResult {
  return {
    passed: !!json?.passed,
    score: typeof json?.score === 'number' ? json.score : 0,
    feedback: json?.feedback || '',
    ...(json?.strength ? { strength: json.strength } : {}),
    ...(json?.improvement ? { improvement: json.improvement } : {}),
    ...(Array.isArray(json?.rubricGrades) && json.rubricGrades.length ? { rubricGrades: json.rubricGrades } : {}),
  };
}

/** The result in the fields a step's saved progress keeps, so a reload can rebuild it. */
export function shortAnswerProgressFields(result: ShortAnswerResult) {
  return {
    aiPassed: result.passed,
    aiScore: result.score,
    aiFeedback: result.feedback,
    aiStrength: result.strength,
    aiImprovement: result.improvement,
    aiGrades: result.rubricGrades,
  };
}

/** The saved result of a step, or null when it has none (or its last review never ran). */
export function savedShortAnswerResult(entry: any): ShortAnswerFeedback | null {
  if (!entry?.aiFeedback || entry.aiErrored) return null;
  return shortAnswerResultOf({
    passed: entry.aiPassed, score: entry.aiScore, feedback: entry.aiFeedback,
    strength: entry.aiStrength, improvement: entry.aiImprovement, rubricGrades: entry.aiGrades,
  });
}

export default function ShortAnswerReviewResult({ result, isDark, accentColor }: {
  result: ShortAnswerResult;
  isDark: boolean;
  accentColor: string;
}) {
  const t = reviewTheme(isDark);
  // Tinted, so the white cards inside stand out on the white step around them.
  const shell = isDark ? '#26272F' : '#F2F5FA';

  if (result.rubricGrades?.length) {
    return (
      <div className="rounded-[20px] p-3 sm:p-4" style={{ background: shell }}>
        <RubricReviewReport reportLabel="Review of your answer" workNoun="answer" summary={result.feedback}
          grades={result.rubricGrades} score={result.score} minScore={PASS_MARK} attemptsLeft={null}
          isDark={isDark} accentColor={accentColor} showClosingNote={false} />
      </div>
    );
  }

  const parts = [
    result.strength ? { label: 'What worked', text: result.strength, Icon: Check, tone: t.met } : null,
    result.improvement ? { label: 'What to change', text: result.improvement, Icon: ArrowRight, tone: result.passed ? t.ungraded : t.failed } : null,
  ].filter((part): part is NonNullable<typeof part> => !!part);

  return (
    <div className="space-y-3 rounded-[20px] p-3 sm:p-4" style={{ background: shell }}>
      <ReviewResultCard good={result.passed} heading={result.passed ? 'Passed' : 'Not passed yet'} resultLine={result.feedback}
        score={result.score} minScore={PASS_MARK} isDark={isDark} />
      {parts.length > 0 && (
        <div className="flex flex-col gap-4 rounded-[20px] p-5 sm:p-6" style={{ background: t.card }}>
          {parts.map(({ label, text, Icon, tone }) => (
            <div key={label} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: tone.dot, color: tone.icon }}>
                <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold" style={{ color: t.text }}>{label}</p>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: t.text }}>{text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
