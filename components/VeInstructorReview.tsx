'use client';

// The instructor's review of a student's standalone virtual experience: overall score, feedback,
// and a report on each uploaded file. Shown in two places so a student cannot miss it: the VE
// details on the student dashboard (where the review email lands) and inside the completed VE.

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, MessageSquare } from 'lucide-react';
import InstructorFileReportView from '@/components/InstructorFileReportView';
import { isReportStale } from '@/lib/ve-instructor-report';

interface Colors { text: string; muted: string; faint: string }

/** True when there is anything to show: an overall score, feedback, or a file report. */
export function hasInstructorReview(review: any): boolean {
  return !!review && (review.score !== undefined || !!review.feedback || Object.keys(review.reports ?? {}).length > 0);
}

export default function VeInstructorReview({ review, modules, progress, accentColor, isDark, colors, focus = false, scrollOnFocus = true }: {
  review: any;
  modules: any[];
  progress: Record<string, any> | null | undefined;
  accentColor: string;
  isDark: boolean;
  colors: Colors;
  // Arrived from the review email: scroll here and open the first file report.
  focus?: boolean;
  // Off inside a pop-up, which already opens at the review; scrolling would push its close button away.
  scrollOnFocus?: boolean;
}) {
  // Instructor reports on uploaded files, in course order, labelled by the step they belong to.
  const fileReports: { reqId: string; label: string; report: any; stale: boolean }[] = [];
  const saved = review?.reports ?? {};
  for (const m of modules ?? []) for (const l of m?.lessons ?? []) for (const r of l?.requirements ?? []) {
    if (saved[r.id]) fileReports.push({
      reqId: r.id, label: r.label || l.title || 'Uploaded file', report: saved[r.id],
      // Written about a file the student has since replaced.
      stale: isReportStale(saved[r.id], progress?.[r.id]?.fileUrl),
    });
  }

  const [openReport, setOpenReport] = useState<string | null>(focus ? fileReports[0]?.reqId ?? null : null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus || !scrollOnFocus) return;
    // After the details drawer has slid in, so the scroll lands on its final position.
    const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [focus, scrollOnFocus]);

  if (!hasInstructorReview(review)) return null;
  // Surfaces follow the rubric report: a tinted section holding white rows, so the reports opened
  // inside it (white cards of their own) stand out whichever surface this sits on.
  const section = isDark ? '#26272F' : '#F2F5FA';
  const row = isDark ? '#1E1F26' : '#ffffff';
  const track = isDark ? '#3a3c47' : '#e2e5ea';
  const score = typeof review.score === 'number' ? Math.max(0, Math.min(100, review.score)) : null;
  const reviewedOn = review.reviewed_at
    ? new Date(review.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <section ref={ref} className="space-y-3 scroll-mt-4" aria-label="Your instructor's review">
      <div>
        <p className="text-[13px] font-semibold" style={{ color: colors.text }}>Instructor review</p>
        {reviewedOn && <p className="mt-0.5 text-xs" style={{ color: colors.muted }}>Reviewed on {reviewedOn}</p>}
      </div>

      <div className="flex flex-col gap-5 rounded-[20px] p-5 sm:flex-row sm:items-center sm:p-6" style={{ background: section }}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `${accentColor}1f`, color: accentColor }}>
              <MessageSquare className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <h2 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl" style={{ color: colors.text }}>Your instructor reviewed your work</h2>
          </div>
          {review.feedback
            ? <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: colors.text }}>{review.feedback}</p>
            : fileReports.length > 0 && <p className="text-sm leading-relaxed" style={{ color: colors.muted }}>Open each file report below for the detail.</p>}
        </div>
        {score !== null && (
          <div className="flex shrink-0 flex-col gap-2.5 rounded-2xl p-4 sm:w-44" style={{ background: row }}>
            <div className="flex items-baseline gap-1">
              <span className="text-[40px] font-bold leading-none tabular-nums" style={{ color: colors.text }}>{Math.round(score)}</span>
              <span className="text-sm font-semibold" style={{ color: colors.muted }}>/ 100</span>
            </div>
            <div role="img" aria-label={`${Math.round(score)} of 100`} className="h-2.5 rounded-full" style={{ background: track }}>
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: accentColor }} />
            </div>
            <p className="text-xs font-medium" style={{ color: colors.muted }}>Overall score</p>
          </div>
        )}
      </div>

      {fileReports.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[20px] p-5 sm:p-6" style={{ background: section }}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[17px] font-bold" style={{ color: colors.text }}>
              {fileReports.length === 1 ? 'Report on your file' : 'Reports on your files'}
            </h3>
            {fileReports.length > 1 && <span className="shrink-0 text-[13px] font-semibold" style={{ color: colors.muted }}>{fileReports.length} files</span>}
          </div>
          {fileReports.map(({ reqId, label, report, stale }) => {
            const open = openReport === reqId;
            return (
              <div key={reqId} className="space-y-3">
                <button onClick={() => setOpenReport(open ? null : reqId)} aria-expanded={open}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-[14px] p-4 text-left" style={{ background: row }}>
                  <FileText className="h-5 w-5 shrink-0" style={{ color: accentColor }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug" style={{ color: colors.text }}>{label}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: colors.muted }}>
                      {stale ? 'About a file you have since replaced' : open ? 'Hide report' : 'View report'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: colors.text }}>{report.score} / 100</span>
                  <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: colors.muted }} aria-hidden="true" />
                </button>
                {open && (
                  <div className="space-y-3">
                    {stale && (
                      <p className="text-xs" style={{ color: colors.muted }}>
                        This review is about a file you uploaded before. You have replaced it since, so the review may not match your current file.
                      </p>
                    )}
                    <InstructorFileReportView report={report} title={label} accentColor={accentColor} isDark={isDark} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
