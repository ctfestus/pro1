'use client';

// The report for an AI review graded against an instructor's rubric: the result first, then one row
// per criterion carrying its marks, what was checked and, when it is not met, what to change.
// Reviews without a rubric use AiStructuredReviewReport instead.

import type { ReactNode } from 'react';
import { Check, Download, Info, Minus, RotateCcw, X } from 'lucide-react';
import { criterionMarks, isUngraded } from '@/lib/review-gate';

export interface RubricReportGrade {
  criterion: string;
  passed: boolean;
  comment: string;
  location?: string;
  fix?: string;
}

// Reports saved before fixes moved onto the grades carried them as findings titled
// "Criterion <id>: ...". Matched back to their criterion so those reports still show a fix.
export interface RubricReportLegacyFinding {
  title: string;
  location?: string;
  fix?: string;
}

interface Props {
  reportLabel: string;
  metadata?: string;
  /** What the student submitted, as the closing note names it: "workbook", "code", "document". */
  workNoun: string;
  summary: string;
  grades: RubricReportGrade[];
  legacyFindings?: RubricReportLegacyFinding[];
  /** The share of the rubric met, 0-100: the number that gates the student. */
  score: number;
  minScore?: number;
  /** Review attempts left; null when attempts are not limited. */
  attemptsLeft: number | null;
  isDark: boolean;
  accentColor: string;
  onExport?: () => void;
  onRetry?: () => void;
  /** Anything to show between the header and the result, such as a reading-limit warning. */
  children?: ReactNode;
}

type RowStatus = 'met' | 'failed' | 'ungraded' | 'note';

const LIGHT = {
  card: '#ffffff', inner: '#F7F7F7', text: '#111111', muted: '#555555', track: '#e2e5ea', marker: '#111111',
  chipBg: '#F4F4F4', chipText: '#555555', fixBox: '#ffffff', failText: '#555555',
  met: { dot: '#16a34a', icon: '#ffffff', label: '#15803d', row: '#F7F7F7' },
  failed: { dot: '#dc2626', icon: '#ffffff', label: '#b91c1c', row: '#fef2f2' },
  ungraded: { dot: '#b45309', icon: '#ffffff', label: '#b45309', row: '#fffbeb' },
  note: { dot: '#e2e5ea', icon: '#555555', label: '#555555', row: '#F7F7F7' },
  passBubble: { bg: '#f0fdf4', fg: '#15803d' }, failBubble: { bg: '#fef2f2', fg: '#b91c1c' },
  passBar: '#16a34a', failBar: '#dc2626', retryText: '#ffffff',
};

const DARK: typeof LIGHT = {
  card: '#1E1F26', inner: '#26272F', text: '#f8fafc', muted: '#A8B5C2', track: '#3a3c47', marker: '#f8fafc',
  chipBg: '#2E3039', chipText: '#C5CED8', fixBox: '#1E1F26', failText: '#C5CED8',
  met: { dot: '#4ade80', icon: '#0b1220', label: '#4ade80', row: '#26272F' },
  failed: { dot: '#f87171', icon: '#0b1220', label: '#fca5a5', row: '#33232A' },
  ungraded: { dot: '#fbbf24', icon: '#0b1220', label: '#fbbf24', row: '#322B1F' },
  note: { dot: '#3a3c47', icon: '#C5CED8', label: '#A8B5C2', row: '#26272F' },
  passBubble: { bg: 'rgba(74,222,128,0.16)', fg: '#4ade80' }, failBubble: { bg: 'rgba(248,113,113,0.16)', fg: '#f87171' },
  passBar: '#4ade80', failBar: '#f87171', retryText: '#0b1220',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function RubricReviewReport({
  reportLabel, metadata, workNoun, summary, grades, legacyFindings = [], score, minScore, attemptsLeft,
  isDark, accentColor, onExport, onRetry, children,
}: Props) {
  const t = isDark ? DARK : LIGHT;

  const rows = grades.map((grade, index) => {
    const marks = criterionMarks(grade.criterion);
    const status: RowStatus = marks.note ? 'note' : isUngraded(grade) ? 'ungraded' : grade.passed ? 'met' : 'failed';
    const legacy = legacyFindings.find(f => new RegExp(`^\\s*Criterion\\s+${index + 1}\\b`, 'i').test(f.title));
    return { grade, marks, status, location: grade.location || legacy?.location || '', fix: grade.fix || legacy?.fix || '' };
  });
  const graded = rows.filter(row => row.status !== 'note');
  const total = graded.length;
  const met = graded.filter(row => row.status === 'met').length;
  const hasMarks = graded.some(row => row.marks.explicit);
  const totalMarks = graded.reduce((sum, row) => sum + row.marks.weight, 0);
  const earnedMarks = graded.reduce((sum, row) => sum + (row.status === 'met' ? row.marks.weight : 0), 0);
  const safeScore = Math.max(0, Math.min(100, score));
  const allMet = total > 0 && met === total;
  // With a pass mark the result is pass or fail; without one, how many criteria were met.
  const good = minScore ? safeScore >= minScore : allMet;

  const heading = minScore ? (good ? 'Passed' : 'Not passed yet') : allMet ? 'All criteria met' : `${met} of ${total} criteria met`;
  const metText = allMet && total > 1 ? `all ${total} criteria` : total === 1 ? `${met} of 1 criterion` : `${met} of ${total} criteria`;
  const marksText = hasMarks ? ` and earned ${fmt(earnedMarks)} of ${fmt(totalMarks)} marks` : '';
  const passText = !minScore ? ''
    : good ? ` The pass mark is ${minScore}.`
    : hasMarks && totalMarks === 100 ? ` You need ${minScore} to pass.` : ` You need ${minScore} out of 100 to pass.`;
  const resultLine = `You met ${metText}${marksText}.${passText}`;

  const closingNote = good ? null
    : attemptsLeft === 0
      ? `Fix the criteria marked not met in your ${workNoun}. You have no review attempts left.`
      : `Fix the criteria marked not met, update your ${workNoun}, and submit another review.${attemptsLeft ? ` You have ${plural(attemptsLeft, 'attempt')} left.` : ''}`;

  const bubble = good ? t.passBubble : t.failBubble;
  const buttonBase = 'flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold';

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)', color: t.text }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: t.text }}>{reportLabel}</p>
          {metadata && <p className="mt-0.5 text-xs" style={{ color: t.muted }}>{metadata}</p>}
        </div>
        <div className="flex gap-2">
          {onExport && (
            <button type="button" onClick={onExport} className={buttonBase} style={{ background: t.card, color: t.text }}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export
            </button>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className={buttonBase} style={{ background: accentColor, color: t.retryText }}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      </div>

      {children}

      <section className="flex flex-col gap-5 rounded-[20px] p-6 sm:flex-row sm:items-center" style={{ background: t.card }}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: bubble.bg, color: bubble.fg }}>
              {good ? <Check className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" /> : <X className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />}
            </span>
            <h2 className="text-2xl font-bold tracking-[-0.02em]" style={{ color: t.text }}>{heading}</h2>
          </div>
          <p className="text-[15px] leading-normal" style={{ color: t.text }}>{resultLine}</p>
          {summary && <p className="text-sm leading-relaxed" style={{ color: t.muted }}>{summary}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2.5 rounded-2xl p-4 sm:w-44" style={{ background: t.inner }}>
          <div className="flex items-baseline gap-1">
            <span className="text-[40px] font-bold leading-none tabular-nums" style={{ color: t.text }}>{Math.round(safeScore)}</span>
            <span className="text-sm font-semibold" style={{ color: t.muted }}>/ 100</span>
          </div>
          <div role="img" aria-label={`${Math.round(safeScore)} of 100${minScore ? `, pass mark ${minScore}` : ''}`}
            className="relative h-2.5 rounded-full" style={{ background: t.track }}>
            <div className="h-full rounded-full" style={{ width: `${safeScore}%`, background: good ? t.passBar : t.failBar }} />
            {minScore ? <div className="absolute -top-1 h-[18px] w-0.5" style={{ left: `${Math.min(100, minScore)}%`, background: t.marker }} /> : null}
          </div>
          {minScore ? <p className="text-xs font-medium" style={{ color: t.muted }}>Pass mark {minScore}</p> : null}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-[20px] p-6" style={{ background: t.card }}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[17px] font-bold" style={{ color: t.text }}>What you were asked to do</h3>
          <span className="shrink-0 text-[13px] font-semibold" style={{ color: t.muted }}>{met} of {total} met</span>
        </div>

        {rows.map(({ grade, marks, status, location, fix }, index) => {
          const tone = t[status];
          const statusText = status === 'note' ? 'Guidance, no marks'
            : hasMarks ? `${fmt(status === 'met' ? marks.weight : 0)} of ${fmt(marks.weight)} marks`
            : status === 'met' ? 'Met' : status === 'ungraded' ? 'Not graded' : 'Not met';
          const comment = status === 'ungraded'
            ? `The AI reviewer did not grade this criterion, so it counts as not met.${onRetry ? ' Submit again to have it graded.' : ''}`
            : grade.comment;
          const Icon = status === 'met' ? Check : status === 'failed' ? X : status === 'ungraded' ? Minus : Info;
          const iconLabel = status === 'met' ? 'Met' : status === 'failed' ? 'Not met' : status === 'ungraded' ? 'Not graded' : undefined;
          return (
            <div key={index} className="flex gap-3 rounded-[14px] p-4" style={{ background: tone.row }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: tone.dot, color: tone.icon }}>
                <Icon className="h-3.5 w-3.5" strokeWidth={3} role={iconLabel ? 'img' : undefined} aria-label={iconLabel} aria-hidden={iconLabel ? undefined : true} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-snug" style={{ color: t.text }}>{grade.criterion}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold" style={{ color: tone.label }}>{statusText}</span>
                </div>
                {comment && (
                  <p className="text-[13px] leading-relaxed" style={{ color: status === 'failed' || status === 'ungraded' ? t.failText : t.muted }}>{comment}</p>
                )}
                {status === 'failed' && fix && (
                  <div className="mt-1 flex flex-col gap-1.5 rounded-xl p-3.5" style={{ background: t.fixBox }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: t.text }}>What to change</span>
                      {location && (
                        <span className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: t.chipBg, color: t.chipText, fontFamily: 'var(--font-mono)' }}>{location}</span>
                      )}
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: t.text }}>{fix}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {closingNote && (
        <div className="flex items-center gap-2.5 rounded-[14px] px-4 py-3.5" style={{ background: t.card }}>
          <Info className="h-[18px] w-[18px] shrink-0" style={{ color: t.muted }} aria-hidden="true" />
          <p className="text-[13px] leading-normal" style={{ color: t.muted }}>{closingNote}</p>
        </div>
      )}
    </div>
  );
}

/** A report is shown as a rubric review when it was graded on a rubric and carries no quality audit. */
export function isRubricReport(report: { rubricGrades?: unknown[]; categories?: unknown[] } | null | undefined): boolean {
  return !!report && (report.rubricGrades?.length ?? 0) > 0 && (report.categories?.length ?? 0) === 0;
}
