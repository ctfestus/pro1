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

export default function VeInstructorReview({ review, modules, progress, accentColor, isDark, colors, focus = false }: {
  review: any;
  modules: any[];
  progress: Record<string, any> | null | undefined;
  accentColor: string;
  isDark: boolean;
  colors: Colors;
  // Arrived from the review email: scroll here and open the first file report.
  focus?: boolean;
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
    if (!focus) return;
    // After the details drawer has slid in, so the scroll lands on its final position.
    const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [focus]);

  if (!hasInstructorReview(review)) return null;
  const tint = `${accentColor}0e`;

  return (
    <section ref={ref} className="space-y-3 scroll-mt-4" aria-label="Your instructor's review">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <h3 className="text-sm font-semibold" style={{ color: colors.text }}>Your instructor&apos;s review</h3>
        {review.score !== undefined && (
          <span className="ml-auto text-sm font-bold tabular-nums" style={{ color: colors.text }}>{review.score}/100</span>
        )}
      </div>

      {review.feedback && (
        <div className="text-sm leading-relaxed px-4 py-3 rounded-xl whitespace-pre-line" style={{ background: tint, color: colors.text }}>
          {review.feedback}
        </div>
      )}

      {fileReports.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium" style={{ color: colors.muted }}>
            {fileReports.length === 1 ? 'Report on your uploaded file' : `Reports on your ${fileReports.length} uploaded files`}
          </p>
          {fileReports.map(({ reqId, label, report, stale }) => {
            const open = openReport === reqId;
            return (
              <div key={reqId} className="rounded-xl" style={{ background: tint }}>
                <button onClick={() => setOpenReport(open ? null : reqId)} aria-expanded={open}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <FileText className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate" style={{ color: colors.text }}>{label}</span>
                    {stale && <span className="block text-xs" style={{ color: colors.muted }}>About your earlier file</span>}
                  </span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: colors.text }}>{report.score}/100</span>
                  <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: colors.muted }} />
                </button>
                {open && (
                  <div className="px-2 pb-2 sm:px-3 sm:pb-3">
                    {stale && (
                      <p className="text-xs px-2 pb-2" style={{ color: colors.muted }}>
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
